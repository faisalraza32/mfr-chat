import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProvider } from "./providers/index.js";
import { runChatTurn } from "./run.js";
import { createToolset, type ChatTool } from "./tools.js";
import type { ChatEvent } from "./types.js";

/**
 * Verifies the request we actually put on the wire, without spending a real
 * API call. The cache breakpoint in particular is the main cost lever — if it
 * moves or the prefix stops being static, every message silently costs ~10x
 * more, and nothing else in the suite would catch it.
 */

const SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"We build mobile and web software."}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":8}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
].join("");

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    max_tokens: number;
    thinking: Record<string, unknown>;
    output_config: Record<string, unknown>;
    system: Array<{ text: string; cache_control?: Record<string, unknown> }>;
    tools: Array<{
      name: string;
      strict: boolean;
      input_schema: { additionalProperties: boolean };
    }>;
    messages: Array<{ role: string; content: unknown }>;
  };
}

let captured: CapturedRequest;

function stubFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    captured = {
      url: input instanceof Request ? input.url : String(input),
      headers: Object.fromEntries(new Headers(init?.headers ?? {}).entries()),
      body: JSON.parse(String(init?.body ?? "{}")),
    };

    return new Response(SSE, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  });
}

/** The same reply arriving in two chunks, so buffering is visible in a test. */
const SSE_IN_TWO_PARTS = SSE.replace(
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"We build mobile and web software."}}\n\n',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"We build mobile "}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"and web software."}}\n\n'
);

function stubChunkedFetch() {
  return vi.fn(
    async () =>
      new Response(SSE_IN_TWO_PARTS, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
  );
}

const GUARDRAILS = "You are a helpful assistant. Stay on topic.";
const KNOWLEDGE = "COMPANY KNOWLEDGE\n\nWe build mobile and web software.";

const echoTool: ChatTool<null> = {
  definition: {
    name: "echo",
    description: "Echo the input back.",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
  },
  run: async (input) => ({ content: String(input.value ?? ""), isError: false }),
};

function run(overrides: Partial<Parameters<typeof runChatTurn<null>>[0]> = {}) {
  return runChatTurn<null>({
    provider: createProvider({ id: "anthropic", apiKey: "sk-ant-test" }),
    guardrails: GUARDRAILS,
    knowledge: KNOWLEDGE,
    toolset: createToolset<null>([echoTool]),
    toolContext: null,
    conversationId: "c1",
    history: [],
    userMessage: "Hi",
    emit: () => {},
    logUsage: () => {},
    ...overrides,
  });
}

describe("runChatTurn request shape", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", stubFetch());
  });

  it("streams text back and returns it", async () => {
    const deltas: string[] = [];
    const result = await run({
      userMessage: "What do you do?",
      emit: (event: ChatEvent) => {
        if (event.type === "delta") deltas.push(event.text);
      },
    });

    expect(deltas.join("")).toBe("We build mobile and web software.");
    expect(result.text).toBe("We build mobile and web software.");
  });

  it("defaults to claude-opus-5 with adaptive thinking and low effort", async () => {
    await run();

    expect(captured.body.model).toBe("claude-opus-5");
    expect(captured.body.thinking).toEqual({ type: "adaptive" });
    expect(captured.body.output_config).toEqual({ effort: "low" });
    expect(captured.body.max_tokens).toBe(2048);
    // budget_tokens is rejected with a 400 on Opus 5.
    expect(captured.body.thinking).not.toHaveProperty("budget_tokens");
  });

  it("puts the cache breakpoint after the knowledge base, not the guardrails", async () => {
    // A sentinel rather than a short word — "Hi" occurs inside "Highlights".
    const sentinel = "ZZQX-volatile-marker-9137";

    await run({ userMessage: sentinel });

    const system = captured.body.system;
    expect(system).toHaveLength(2);
    expect(system[0].cache_control).toBeUndefined();
    expect(system[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(system[1].text).toContain("COMPANY KNOWLEDGE");
    // Everything volatile must sit after the breakpoint, or the cached prefix
    // changes on every message and never gets a hit.
    expect(JSON.stringify(system)).not.toContain(sentinel);
    expect(JSON.stringify(captured.body.messages)).toContain(sentinel);
  });

  it("sends the toolset's definitions with strict schemas", async () => {
    await run();

    expect(captured.body.tools.map((tool) => tool.name)).toEqual(["echo"]);

    for (const tool of captured.body.tools) {
      expect(tool.strict).toBe(true);
      expect(tool.input_schema.additionalProperties).toBe(false);
    }
  });

  it("replays history in order, with the new message last", async () => {
    await run({
      history: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
      ],
      userMessage: "third",
    });

    expect(captured.body.messages).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ]);
  });

  it("omits the workspace header unless configured", async () => {
    await run();

    expect(captured.headers["anthropic-workspace-id"]).toBeUndefined();
  });

  it("sends the workspace header for identity-linked keys", async () => {
    await run({
      provider: createProvider({
        id: "anthropic",
        apiKey: "sk-ant-test",
        workspaceId: "wrkspc_test123",
      }),
    });

    expect(captured.headers["anthropic-workspace-id"]).toBe("wrkspc_test123");
  });

  it("honours a model override", async () => {
    await run({
      provider: createProvider({
        id: "anthropic",
        apiKey: "sk-ant-test",
        model: "claude-sonnet-5",
      }),
    });

    expect(captured.body.model).toBe("claude-sonnet-5");
  });
});

describe("the wrap-up steer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", stubFetch());
  });

  it("stays out of the prompt while the conversation has room", async () => {
    await run({ messagesRemaining: 20 });

    expect(JSON.stringify(captured.body.messages)).not.toContain("System note");
  });

  it("is appended to the visitor's message near the cap, never to the cached prefix", async () => {
    await run({ userMessage: "What next?", messagesRemaining: 2 });

    const asJson = JSON.stringify(captured.body.messages);
    expect(asJson).toContain("What next?");
    expect(asJson).toContain("close to its length limit");
    // It must not leak into the cached system blocks.
    expect(JSON.stringify(captured.body.system)).not.toContain("System note");
  });

  it("lets the host phrase the steer, since only it knows the next step", async () => {
    // The default cannot name one: it does not know which tools you gave the
    // assistant. Genericising a host's wording during a refactor silently
    // changes what the model does, so this is pinned.
    await run({
      userMessage: "What next?",
      messagesRemaining: 1,
      wrapUpNote: "offer to book a call or take a message.",
    });

    const asJson = JSON.stringify(captured.body.messages);
    expect(asJson).toContain("offer to book a call or take a message.");
    expect(asJson).not.toContain("close to its length limit");
  });
});

describe("the reply validator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", stubChunkedFetch());
  });

  it("holds the reply back until it is whole, then sends it in one piece", async () => {
    // The point of the hook: there is no moment where half a reply is on
    // screen and the rest has not been checked yet.
    const deltas: string[] = [];
    const seen: string[] = [];

    const result = await run({
      emit: (event: ChatEvent) => {
        if (event.type === "delta") deltas.push(event.text);
      },
      validateReply: (text) => {
        seen.push(text);
        return null;
      },
    });

    expect(seen).toEqual(["We build mobile and web software."]);
    expect(deltas).toEqual(["We build mobile and web software."]);
    expect(result.text).toBe("We build mobile and web software.");
  });

  it("sends the replacement instead, and never the original", async () => {
    const deltas: string[] = [];

    const result = await run({
      emit: (event: ChatEvent) => {
        if (event.type === "delta") deltas.push(event.text);
      },
      validateReply: () => "I can't help with that one.",
    });

    expect(deltas).toEqual(["I can't help with that one."]);
    expect(deltas.join("")).not.toContain("mobile and web software");
    // What the host stores is what the visitor saw, not what the model wrote.
    expect(result.text).toBe("I can't help with that one.");
  });

  it("awaits a validator that has work to do", async () => {
    // The case this exists for: a host whose replacement is computed rather
    // than canned, by answering again from its own data.
    const deltas: string[] = [];

    const result = await run({
      emit: (event: ChatEvent) => {
        if (event.type === "delta") deltas.push(event.text);
      },
      validateReply: async (text) => {
        await Promise.resolve();

        return text.includes("software") ? "Computed instead." : null;
      },
    });

    expect(deltas).toEqual(["Computed instead."]);
    expect(result.text).toBe("Computed instead.");
  });

  it("sends nothing before an async validator has answered", async () => {
    // Awaiting it must not mean streaming the original first and correcting
    // afterwards, which is the thing buffering exists to prevent.
    const events: Array<{ at: number; text: string }> = [];
    let ticks = 0;
    const tick = () => (ticks += 1);

    await run({
      emit: (event: ChatEvent) => {
        if (event.type === "delta") events.push({ at: ticks, text: event.text });
      },
      validateReply: async () => {
        tick();
        await Promise.resolve();
        tick();

        return "Checked.";
      },
    });

    expect(events).toEqual([{ at: 2, text: "Checked." }]);
  });

  it("streams chunk by chunk when no validator is given", async () => {
    // The hook is opt-in: without one, nothing about the stream changes, and
    // a reply the provider sends in two parts still arrives in two.
    const deltas: string[] = [];

    await run({
      emit: (event: ChatEvent) => {
        if (event.type === "delta") deltas.push(event.text);
      },
    });

    expect(deltas).toEqual(["We build mobile ", "and web software."]);
  });
});
