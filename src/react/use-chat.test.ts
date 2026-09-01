// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDLE_CHALLENGE_MS, IDLE_RESET_MS } from "./session.js";
import { createChatStorage } from "./storage.js";
import { useChat } from "./use-chat.js";

const COPY = { error: "Something went wrong.", securityExpired: "Session timed out." };
const storage = createChatStorage("test:chat");
const CHAT_STORAGE_KEYS = storage.keys;

/** The options every case shares. */
const options = { copy: COPY, storage };
const CONVERSATION = "3f1a7b2c-4d5e-4f60-8a91-2b3c4d5e6f70";

/** Shaped like the server's `conversationId.expiresAt.signature`. */
function sessionToken(expiresAt: number): string {
  return `${CONVERSATION}.${expiresAt}.c2lnbmF0dXJl`;
}

function seed({
  expiresAt,
  lastActivityAt,
}: {
  expiresAt: number;
  lastActivityAt: number;
}) {
  sessionStorage.setItem(CHAT_STORAGE_KEYS.conversation, CONVERSATION);
  sessionStorage.setItem(CHAT_STORAGE_KEYS.session, sessionToken(expiresAt));
  sessionStorage.setItem(CHAT_STORAGE_KEYS.activity, String(lastActivityAt));
  sessionStorage.setItem(
    CHAT_STORAGE_KEYS.messages,
    JSON.stringify([{ id: "1", role: "user", text: "Earlier question" }])
  );
}

/** A 200 whose body is the SSE stream the server would send. */
function streamResponse(...events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });

  return new Response(stream, { status: 200 });
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useChat session recovery", () => {
  it("challenges again rather than trusting a token the server has expired", () => {
    // The reported bug: away for hours, the tab still held a token, so the
    // widget stayed hidden and every send came back "complete the security
    // check" with no way to complete it.
    seed({ expiresAt: Date.now() - 1000, lastActivityAt: Date.now() - 60_000 });

    const { result } = renderHook(() => useChat(options));

    expect(result.current.hasSession).toBe(false);
    expect(sessionStorage.getItem(CHAT_STORAGE_KEYS.session)).toBeNull();
    // The thread the visitor was reading is still there.
    expect(result.current.messages).toHaveLength(1);
  });

  it("keeps a live session so a returning visitor is not challenged for nothing", () => {
    seed({
      expiresAt: Date.now() + 60 * 60 * 1000,
      lastActivityAt: Date.now() - 60_000,
    });

    const { result } = renderHook(() => useChat(options));

    expect(result.current.hasSession).toBe(true);
  });

  it("challenges after the idle window even while the token is in date", () => {
    seed({
      expiresAt: Date.now() + 60 * 60 * 1000,
      lastActivityAt: Date.now() - IDLE_CHALLENGE_MS - 1000,
    });

    const { result } = renderHook(() => useChat(options));

    expect(result.current.hasSession).toBe(false);
    expect(result.current.messages).toHaveLength(1);
  });

  it("retires the conversation once the visitor has been away long enough", () => {
    seed({
      expiresAt: Date.now() + 60 * 60 * 1000,
      lastActivityAt: Date.now() - IDLE_RESET_MS - 1000,
    });

    const { result } = renderHook(() => useChat(options));

    expect(result.current.hasSession).toBe(false);
    expect(result.current.messages).toEqual([]);
    expect(sessionStorage.getItem(CHAT_STORAGE_KEYS.conversation)).toBeNull();
  });

  it("puts the widget back when the server rejects the security session", async () => {
    seed({
      expiresAt: Date.now() + 60 * 60 * 1000,
      lastActivityAt: Date.now() - 60_000,
    });

    vi.mocked(fetch).mockResolvedValue(
      Response.json(
        { ok: false, error: "Please complete the security check.", code: "turnstile_required" },
        { status: 400 }
      )
    );

    const { result } = renderHook(() => useChat(options));
    expect(result.current.hasSession).toBe(true);

    const key = result.current.challengeKey;
    let outcome: string | undefined;

    await act(async () => {
      outcome = await result.current.send("Are you still there?", "");
    });

    expect(outcome).toBe("challenge");
    expect(result.current.hasSession).toBe(false);
    // A fresh widget, not the one whose token was just refused.
    expect(result.current.challengeKey).toBeGreaterThan(key);
    expect(sessionStorage.getItem(CHAT_STORAGE_KEYS.session)).toBeNull();
    expect(result.current.error).toBe(COPY.securityExpired);
    // The refused message is handed back rather than left in the transcript.
    expect(result.current.messages.some((m) => m.text === "Are you still there?")).toBe(
      false
    );
  });

  it("stores a refreshed token the server slides mid-conversation", async () => {
    seed({
      expiresAt: Date.now() + 60 * 1000,
      lastActivityAt: Date.now() - 60_000,
    });

    const renewed = sessionToken(Date.now() + 2 * 60 * 60 * 1000);

    vi.mocked(fetch).mockResolvedValue(
      streamResponse(
        { type: "session", sessionToken: renewed },
        { type: "delta", text: "Still here." },
        { type: "done" }
      )
    );

    const { result } = renderHook(() => useChat(options));

    await act(async () => {
      await result.current.send("Hello again", "turnstile-token");
    });

    await waitFor(() => expect(result.current.hasSession).toBe(true));
    expect(sessionStorage.getItem(CHAT_STORAGE_KEYS.session)).toBe(renewed);
    expect(sessionStorage.getItem(CHAT_STORAGE_KEYS.activity)).not.toBeNull();
  });
});

describe("useChat wiring", () => {
  it("posts to the configured endpoint with the host's extra metadata", async () => {
    vi.mocked(fetch).mockResolvedValue(
      streamResponse({ type: "delta", text: "Hi." }, { type: "done" })
    );

    const { result } = renderHook(() =>
      useChat({
        ...options,
        endpoint: "/workspace/api/assistant",
        metadata: () => ({ workspaceId: "w_42" }),
      })
    );

    await act(async () => {
      await result.current.send("Hello", "");
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/workspace/api/assistant");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      message: "Hello",
      workspaceId: "w_42",
    });
  });

  it("keeps two apps on one origin from reading each other's threads", () => {
    // The prefix is the only thing separating them in sessionStorage.
    const mine = createChatStorage("app-a:chat");
    const theirs = createChatStorage("app-b:chat");

    sessionStorage.setItem(
      theirs.keys.messages,
      JSON.stringify([{ id: "1", role: "user", text: "Their private thread" }])
    );

    const { result } = renderHook(() =>
      useChat({ copy: COPY, storage: mine })
    );

    expect(result.current.messages).toEqual([]);
  });

  it("carries an action from a tool onto the message it arrived with", async () => {
    // The core passes a tool's own fields through untouched, so the hook must
    // not assume any particular shape.
    vi.mocked(fetch).mockResolvedValue(
      streamResponse(
        { type: "delta", text: "Pick a time." },
        { type: "action", action: "booking", name: "Ada", email: "ada@example.com" },
        { type: "done" }
      )
    );

    const { result } = renderHook(() => useChat(options));

    await act(async () => {
      await result.current.send("Book me in", "");
    });

    const assistant = result.current.messages.at(-1);
    expect(assistant?.action).toEqual({
      action: "booking",
      name: "Ada",
      email: "ada@example.com",
    });
  });
});
