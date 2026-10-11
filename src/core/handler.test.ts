import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleChatRequest, type ChatHandlerDeps } from "./handler.js";
import type { ChatStore, ConversationMeta } from "./ports.js";
import type {
  ChatProvider,
  ProviderTurn,
  StreamTurnRequest,
} from "./providers/types.js";
import { issueSessionToken } from "./session.js";
import { createToolset } from "./tools.js";
import type { ChatEvent, StoredMessage } from "./types.js";

/**
 * The handler is where the Cloudflare coupling used to live — D1, Turnstile,
 * rate-limit bindings, ctx.waitUntil. These tests exist to prove it is gone:
 * everything below is a plain object, and none of it knows what a Worker is.
 */

const CONVERSATION = "3f1a7b2c-4d5e-4f60-8a91-2b3c4d5e6f70";
const SECRET = "test-secret-value-that-is-long-enough";

function fakeStore(overrides: Partial<ChatStore> = {}) {
  const turns: Array<{ user: string; assistant: string }> = [];
  const conversations = new Map<string, ConversationMeta>();
  let history: StoredMessage[] = [];
  let messageCount = 0;

  const store: ChatStore & {
    turns: typeof turns;
    conversations: typeof conversations;
    setHistory(next: StoredMessage[]): void;
    setMessageCount(next: number): void;
  } = {
    turns,
    conversations,
    setHistory: (next) => {
      history = next;
    },
    setMessageCount: (next) => {
      messageCount = next;
    },
    getConversationState: async () => ({
      exists: conversations.size > 0,
      messageCount,
    }),
    loadHistory: async (_id, limit) => history.slice(-limit),
    ensureConversation: async (id, meta) => {
      conversations.set(id, meta);
    },
    recordTurn: async (_id, user, assistant) => {
      turns.push({ user, assistant });
    },
    ...overrides,
  };

  return store;
}

/** A provider that replies with fixed text and never calls a tool. */
function fakeProvider(text = "Hello there."): ChatProvider {
  return {
    id: "openai",
    model: "test-model",
    async streamTurn(request: StreamTurnRequest): Promise<ProviderTurn> {
      request.onText(text);
      return { text, toolCalls: [] };
    },
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deps(
  overrides: Partial<ChatHandlerDeps<null>> = {}
): ChatHandlerDeps<null> {
  return {
    provider: fakeProvider(),
    store: fakeStore(),
    toolset: createToolset<null>([]),
    toolContext: null,
    guardrails: "Be helpful.",
    knowledge: "KNOWLEDGE",
    ...overrides,
  };
}

/** Drains an SSE response body into the events it carried. */
async function readEvents(response: Response): Promise<ChatEvent[]> {
  const text = await response.text();

  return text
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter((frame) => frame.startsWith("data:"))
    .map((frame) => JSON.parse(frame.slice(5).trim()) as ChatEvent);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("handleChatRequest without a human check", () => {
  it("streams a reply and issues no session token", async () => {
    const response = await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "Hi" }),
      deps()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");

    const events = await readEvents(response);

    // No verifier means no challenge, so there is no session to mint — the
    // right shape behind an authenticated app.
    expect(events.find((event) => event.type === "session")).toBeUndefined();
    expect(events).toContainEqual({ type: "delta", text: "Hello there." });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("persists the turn in the background rather than before responding", async () => {
    const store = fakeStore();
    const background: Array<Promise<unknown>> = [];

    const response = await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "Hi" }),
      deps({ store, runInBackground: (work) => void background.push(work) })
    );

    await readEvents(response);
    expect(background).toHaveLength(1);

    await Promise.all(background);
    expect(store.turns).toEqual([{ user: "Hi", assistant: "Hello there." }]);
  });

  it("records the page path and country against the conversation", async () => {
    const store = fakeStore();

    await handleChatRequest(
      post(
        { conversationId: CONVERSATION, message: "Hi", pagePath: "/pricing" },
        { "CF-IPCountry": "CA" }
      ),
      deps({ store })
    );

    expect(store.conversations.get(CONVERSATION)).toEqual({
      pagePath: "/pricing",
      country: "CA",
    });
  });

  it("replays only as much history as the limit allows", async () => {
    const store = fakeStore();
    store.setHistory([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);

    let seen: StoredMessage[] = [];
    const provider: ChatProvider = {
      id: "openai",
      model: "test-model",
      async streamTurn(request) {
        seen = request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        }));
        request.onText("ok");
        return { text: "ok", toolCalls: [] };
      },
    };

    await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "four" }),
      deps({ store, provider, limits: { historyTurnLimit: 2 } })
    );

    expect(seen).toEqual([
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
      { role: "user", content: "four" },
    ]);
  });
});

describe("request rejection", () => {
  it("rejects a body that is not JSON", async () => {
    const response = await handleChatRequest(post("{not json"), deps());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("rejects a conversation id that is not a UUID", async () => {
    const response = await handleChatRequest(
      post({ conversationId: "../etc/passwd", message: "Hi" }),
      deps()
    );

    expect(response.status).toBe(400);
  });

  it("refuses once the conversation has used all its turns", async () => {
    const store = fakeStore();
    store.setMessageCount(20);

    const response = await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "Hi" }),
      deps({ store })
    );

    expect(response.status).toBe(429);
  });

  it("stops a rate-limited client before it reaches the provider", async () => {
    const provider = vi.fn(() => fakeProvider());

    const response = await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "Hi" }, {
        "CF-Connecting-IP": "203.0.113.9",
      }),
      deps({
        provider,
        rateLimiter: { isLimited: async (key) => key === "203.0.113.9" },
      })
    );

    expect(response.status).toBe(429);
    expect(provider).not.toHaveBeenCalled();
  });

  it("refuses with a 503 and an urgent alert when a secret is missing", async () => {
    const reportFailure = vi.fn();

    const response = await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "Hi" }),
      deps({ preflight: () => "OPENAI_API_KEY", reportFailure })
    );

    expect(response.status).toBe(503);
    expect(reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "config", urgent: true })
    );
  });

  it("refuses to run a human check it cannot sign a session for", async () => {
    const response = await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "Hi" }),
      deps({ verifyHuman: async () => true })
    );

    expect(response.status).toBe(503);
  });
});

describe("the human check", () => {
  const withVerifier = (
    verify: (token: string, ip: string | null) => Promise<boolean>,
    overrides: Partial<ChatHandlerDeps<null>> = {}
  ) => deps({ sessionSecret: SECRET, verifyHuman: verify, ...overrides });

  it("demands a challenge on the first message, with a code the client matches", async () => {
    const response = await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "Hi" }),
      withVerifier(async () => true)
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "turnstile_required",
    });
  });

  it("rejects a failed challenge with its own code", async () => {
    const response = await handleChatRequest(
      post({
        conversationId: CONVERSATION,
        message: "Hi",
        challengeToken: "bad",
      }),
      withVerifier(async () => false)
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "turnstile_failed",
    });
  });

  it("mints a session on a passed challenge and passes the IP to the verifier", async () => {
    const verify = vi.fn(async () => true);

    const response = await handleChatRequest(
      post(
        {
          conversationId: CONVERSATION,
          message: "Hi",
          turnstileToken: "good-legacy-key",
        },
        { "CF-Connecting-IP": "198.51.100.7" }
      ),
      withVerifier(verify)
    );

    expect(verify).toHaveBeenCalledWith("good-legacy-key", "198.51.100.7");

    const events = await readEvents(response);
    const session = events.find((event) => event.type === "session");

    expect(session).toBeDefined();
  });

  it("does not re-challenge a conversation holding a valid session", async () => {
    const verify = vi.fn(async () => true);
    const sessionToken = await issueSessionToken(SECRET, CONVERSATION);

    const response = await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "Hi", sessionToken }),
      withVerifier(verify)
    );

    expect(verify).not.toHaveBeenCalled();

    const events = await readEvents(response);
    // Nothing to reissue: the token is nowhere near its expiry.
    expect(events.find((event) => event.type === "session")).toBeUndefined();
    expect(events).toContainEqual({ type: "delta", text: "Hello there." });
  });

  it("slides the window for a token nearing expiry, mid-conversation", async () => {
    const sessionToken = await issueSessionToken(SECRET, CONVERSATION, {
      // Ten minutes left of the two hours: inside the refresh window.
      now: Date.now() - 2 * 60 * 60 * 1000 + 10 * 60 * 1000,
    });

    const response = await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "Hi", sessionToken }),
      withVerifier(async () => true)
    );

    const events = await readEvents(response);
    const session = events.find((event) => event.type === "session");

    // A busy conversation must never be interrupted by an expiry it did
    // nothing to earn.
    expect(session).toBeDefined();
    expect(session).not.toMatchObject({ sessionToken });
  });

  it("challenges a token minted for a different conversation", async () => {
    const other = "9c8b7a6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
    const sessionToken = await issueSessionToken(SECRET, other);

    const response = await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "Hi", sessionToken }),
      withVerifier(async () => true)
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "turnstile_required",
    });
  });
});

describe("when the provider fails", () => {
  it("apologises over the stream, reports the failure, and never leaks the cause", async () => {
    const reportFailure = vi.fn();
    const provider = () => {
      throw Object.assign(new Error("Your credit balance is too low"), {
        status: 400,
      });
    };

    const response = await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "Hi" }),
      deps({ provider, reportFailure })
    );

    // The stream has already started, so the failure is an event, not a status.
    expect(response.status).toBe(200);

    const events = await readEvents(response);
    const error = events.find((event) => event.type === "error");

    expect(error).toBeDefined();
    expect(JSON.stringify(error)).not.toContain("credit balance");
    expect(reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "billing", urgent: true })
    );
  });

  it("sends the host's own fallback instead of the apology", async () => {
    // The hours are still the hours when the provider is down: a host with
    // content of its own can answer better than "something went wrong".
    const events = await readEvents(
      await handleChatRequest(
        post({ conversationId: CONVERSATION, message: "when are you open?" }),
        deps({
          provider: () => {
            throw new Error("upstream exploded");
          },
          fallbackReply: (message) =>
            message.includes("open") ? "We're open 9 to 5, Monday to Friday." : null,
        })
      )
    );

    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(
      events.filter((event) => event.type === "delta").map((event) => event.text)
    ).toEqual(["We're open 9 to 5, Monday to Friday."]);
    // Ends like any other turn, so the browser needs no new case.
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("tells the host what went wrong, so it can answer accordingly", async () => {
    const seen: unknown[] = [];

    await readEvents(
      await handleChatRequest(
        post({ conversationId: CONVERSATION, message: "Hi" }),
        deps({
          provider: () => {
            throw Object.assign(new Error("Your credit balance is too low"), {
              status: 400,
            });
          },
          fallbackReply: (_message, failure) => (seen.push(failure), "Something useful."),
        })
      )
    );

    expect(seen).toEqual([
      expect.objectContaining({ kind: "billing", urgent: true }),
    ]);
  });

  it("stores a fallback like any other reply, so the next turn still reads", async () => {
    const store = fakeStore();
    const background: Array<Promise<unknown>> = [];

    await readEvents(
      await handleChatRequest(
        post({ conversationId: CONVERSATION, message: "Hi" }),
        deps({
          store,
          runInBackground: (work) => void background.push(work),
          provider: () => {
            throw new Error("upstream exploded");
          },
          fallbackReply: () => "Here is what I can tell you.",
        })
      )
    );

    await Promise.all(background);

    expect(store.turns).toEqual([
      { user: "Hi", assistant: "Here is what I can tell you." },
    ]);
  });

  it("awaits a fallback that has to be computed", async () => {
    // Sitebuilder's case: the replacement is produced by answering again from
    // the site's own data, with tools, which cannot be done synchronously.
    const events = await readEvents(
      await handleChatRequest(
        post({ conversationId: CONVERSATION, message: "when are you open?" }),
        deps({
          provider: () => {
            throw new Error("upstream exploded");
          },
          fallbackReply: async () => {
            await Promise.resolve();

            return "Computed from our own data.";
          },
        })
      )
    );

    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(
      events.filter((event) => event.type === "delta").map((event) => event.text)
    ).toEqual(["Computed from our own data."]);
  });

  it("falls back to the apology when the host has nothing to say", async () => {
    const events = await readEvents(
      await handleChatRequest(
        post({ conversationId: CONVERSATION, message: "Hi" }),
        deps({
          provider: () => {
            throw new Error("upstream exploded");
          },
          fallbackReply: () => null,
        })
      )
    );

    expect(events.some((event) => event.type === "error")).toBe(true);
  });

  it("does not persist a turn that produced no reply", async () => {
    const store = fakeStore();
    const background: Array<Promise<unknown>> = [];

    const response = await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "Hi" }),
      deps({
        store,
        runInBackground: (work) => void background.push(work),
        provider: () => {
          throw new Error("upstream exploded");
        },
      })
    );

    await readEvents(response);
    await Promise.all(background);

    expect(store.turns).toEqual([]);
  });
});

describe("usage reporting", () => {
  it("reports every model call, so a metered host can sum them", async () => {
    const seen: Array<{ input: number; output: number; provider: string }> = [];

    // Two calls: one that asks for a tool, then one that answers. A host
    // metering by counting turns would bill this as half what it cost.
    let call = 0;
    const provider: ChatProvider = {
      id: "openai",
      model: "test-model",
      async streamTurn(request) {
        call += 1;
        if (call === 1) {
          return {
            text: "",
            toolCalls: [{ id: "t1", name: "echo", input: {} }],
            usage: { input: 8000, output: 20, cacheRead: 0, cacheWrite: 0 },
          };
        }
        request.onText("done");
        return {
          text: "done",
          toolCalls: [],
          usage: { input: 8100, output: 40, cacheRead: 8000, cacheWrite: 0 },
        };
      },
    };

    const toolset = createToolset<null>([
      {
        definition: {
          name: "echo",
          description: "Echo.",
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
        run: async () => ({ content: "ok", isError: false }),
      },
    ]);

    const response = await handleChatRequest(
      post({ conversationId: CONVERSATION, message: "Hi" }),
      deps({
        provider,
        toolset,
        logUsage: (usage) =>
          seen.push({
            input: usage.input,
            output: usage.output,
            provider: usage.provider,
          }),
      })
    );

    await readEvents(response);

    expect(seen).toHaveLength(2);
    expect(seen.reduce((n, u) => n + u.input, 0)).toBe(16100);
    expect(seen.reduce((n, u) => n + u.output, 0)).toBe(60);
    expect(seen[0].provider).toBe("openai");
  });
});
