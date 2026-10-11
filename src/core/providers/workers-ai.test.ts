import { describe, expect, it } from "vitest";

import { runChatTurn } from "../run.js";
import { createToolset, type ChatTool } from "../tools.js";
import type { ChatEvent } from "../types.js";
import {
  createWorkersAiProvider,
  parseWorkersAiResult,
  recoverTextToolCalls,
  shouldOfferTools,
  WORKERS_AI_DEFAULT_MODEL,
  type WorkersAiBinding,
} from "./workers-ai.js";

/**
 * Workers AI is a binding, so there is no fetch to intercept: the fake below
 * is the whole seam. What is worth testing here is the defensive half — the
 * two response shapes, the tool calls the model writes as prose, and when the
 * tool list is withheld — because each exists for a confirmed misbehaviour.
 */
function fakeAi(...replies: unknown[]): WorkersAiBinding & {
  calls: Array<{ model: string; input: Record<string, unknown> }>;
} {
  const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
  let turn = 0;

  return {
    calls,
    async run(model: string, input: Record<string, unknown>) {
      calls.push({ model, input });

      return replies[Math.min(turn++, replies.length - 1)];
    },
  };
}

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

function run(ai: WorkersAiBinding, overrides = {}) {
  return runChatTurn<null>({
    provider: createWorkersAiProvider({ ai }),
    guardrails: "Stay on topic.",
    knowledge: "COMPANY KNOWLEDGE\n\nWe fit boilers.",
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

describe("reading a Workers AI response", () => {
  it("reads the OpenAI-style shape newer models return", () => {
    const parsed = parseWorkersAiResult({
      choices: [
        {
          message: {
            content: "We fit boilers.",
            tool_calls: [
              { id: "c1", function: { name: "echo", arguments: '{"value":"hi"}' } },
            ],
          },
        },
      ],
    });

    expect(parsed.text).toBe("We fit boilers.");
    expect(parsed.toolCalls).toEqual([
      { id: "c1", name: "echo", input: { value: "hi" } },
    ]);
  });

  it("reads the flat shape older models return", () => {
    // Reading only the newer shape would drop every call from these.
    const parsed = parseWorkersAiResult({
      response: "We fit boilers.",
      tool_calls: [{ name: "echo", arguments: { value: "hi" } }],
    });

    expect(parsed.text).toBe("We fit boilers.");
    expect(parsed.toolCalls[0]).toMatchObject({ name: "echo", input: { value: "hi" } });
  });

  it("survives a response with nothing usable in it", () => {
    expect(parseWorkersAiResult(null)).toEqual({ text: "", toolCalls: [] });
    expect(parseWorkersAiResult({})).toEqual({ text: "", toolCalls: [] });
  });
});

describe("tool calls written out as text", () => {
  it("turns a described call back into a real one", () => {
    const { toolCalls, rest } = recoverTextToolCalls(
      'Let me check. {"type":"function","function":{"name":"echo","arguments":{"value":"hi"}}} One moment.',
      ["echo"]
    );

    expect(toolCalls).toEqual([
      { id: "text_0_echo", name: "echo", input: { value: "hi" } },
    ]);
    expect(rest).toBe("Let me check. One moment.");
  });

  it("recovers several at once, which is when it happens most", () => {
    const { toolCalls } = recoverTextToolCalls(
      '{"name":"echo","arguments":{"value":"a"}} {"name":"echo","arguments":{"value":"b"}}',
      ["echo"]
    );

    expect(toolCalls).toHaveLength(2);
  });

  it("will not invent a tool the model was never given", () => {
    // Otherwise a visitor could paste JSON naming a tool and have it run.
    const { toolCalls, rest } = recoverTextToolCalls(
      '{"name":"delete_everything","arguments":{}}',
      ["echo"]
    );

    expect(toolCalls).toEqual([]);
    expect(rest).toContain("delete_everything");
  });

  it("leaves ordinary braces in prose alone", () => {
    const { toolCalls, rest } = recoverTextToolCalls(
      "Use {curly braces} in the template.",
      ["echo"]
    );

    expect(toolCalls).toEqual([]);
    expect(rest).toBe("Use {curly braces} in the template.");
  });
});

describe("when the tool list is offered", () => {
  it("offers tools while no tool has run", () => {
    expect(shouldOfferTools([{ role: "user", content: "Hi" }])).toBe(true);
  });

  it("withholds them once a result is in the conversation", () => {
    // Sent again, the model asks for the same tool for ever.
    expect(
      shouldOfferTools([
        { role: "user", content: "Hi" },
        {
          role: "user",
          content: "",
          toolResults: [
            { id: "1", name: "echo", content: "hi", isError: false },
          ],
        },
      ])
    ).toBe(false);
  });

  it("puts them back after a failed call, so a retry is possible", () => {
    expect(
      shouldOfferTools([
        {
          role: "user",
          content: "",
          toolResults: [
            { id: "1", name: "echo", content: "bad input", isError: true },
          ],
        },
      ])
    ).toBe(true);
  });
});

describe("the provider in the agent loop", () => {
  it("answers, and reports the reply in one piece", async () => {
    // There is no token stream through a binding, so a fragmented delta would
    // be a fiction.
    const deltas: string[] = [];
    const result = await run(fakeAi({ response: "We fit boilers." }), {
      emit: (event: ChatEvent) => {
        if (event.type === "delta") deltas.push(event.text);
      },
    });

    expect(result.text).toBe("We fit boilers.");
    expect(deltas).toEqual(["We fit boilers."]);
  });

  it("sends one system block, knowledge first", async () => {
    const ai = fakeAi({ response: "Hi." });

    await run(ai);

    const [system] = ai.calls[0]!.input.messages as Array<{
      role: string;
      content: string;
    }>;

    expect(system.role).toBe("system");
    expect(system.content.indexOf("COMPANY KNOWLEDGE")).toBeLessThan(
      system.content.indexOf("Stay on topic.")
    );
  });

  it("passes a one-piece prompt through unchanged", async () => {
    // A host that keeps its prompt whole passes it as guardrails and leaves
    // knowledge empty; blank lines in front of it would be a prompt change
    // nobody asked for.
    const ai = fakeAi({ response: "Hi." });

    await run(ai, { knowledge: "", guardrails: "You are Ada." });

    const [system] = ai.calls[0]!.input.messages as Array<{ content: string }>;

    expect(system.content).toBe("You are Ada.");
  });

  it("defaults to a model that supports tools", async () => {
    const ai = fakeAi({ response: "Hi." });

    await run(ai);

    expect(ai.calls[0]!.model).toBe(WORKERS_AI_DEFAULT_MODEL);
    expect(ai.calls[0]!.input.tools).toHaveLength(1);
  });

  it("runs a tool, then answers without the tool list", async () => {
    const ai = fakeAi(
      { tool_calls: [{ name: "echo", arguments: { value: "hello" } }] },
      { response: "It said hello." }
    );

    const result = await run(ai);

    expect(result.text).toBe("It said hello.");
    expect(ai.calls).toHaveLength(2);
    expect(ai.calls[1]!.input.tools).toBeUndefined();
    // The assistant's own call is replayed flattened, not as an object.
    const replayed = ai.calls[1]!.input.messages as Array<{
      role: string;
      content: string;
    }>;
    expect(replayed.some((m) => m.content.startsWith("[tool call echo"))).toBe(true);
    expect(replayed.some((m) => m.role === "tool" && m.content === "hello")).toBe(
      true
    );
  });

  it("reports usage when the model gives it", async () => {
    const usage: Array<{ input: number; output: number }> = [];

    await run(fakeAi({ response: "Hi.", usage: { prompt_tokens: 90, completion_tokens: 4 } }), {
      logUsage: (u: { input: number; output: number }) => usage.push(u),
    });

    expect(usage).toEqual([
      expect.objectContaining({ input: 90, output: 4, cacheRead: 0, cacheWrite: 0 }),
    ]);
  });
});
