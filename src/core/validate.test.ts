import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS } from "./config.js";
import { parseChatRequest } from "./validate.js";

const VALID_ID = "3f1a7b2c-4d5e-4f60-8a91-2b3c4d5e6f70";

describe("parseChatRequest", () => {
  it("accepts a well-formed request", () => {
    expect(
      parseChatRequest({ conversationId: VALID_ID, message: "  Hello  " })
    ).toEqual({
      conversationId: VALID_ID,
      message: "Hello",
      challengeToken: undefined,
      sessionToken: undefined,
      pagePath: undefined,
    });
  });

  it("rejects a conversation id that is not a UUID", () => {
    // Anything else would let a caller pick their own ids and read or pollute
    // another visitor's stored history.
    expect(
      parseChatRequest({ conversationId: "../../etc", message: "Hi" })
    ).toBeNull();
    expect(parseChatRequest({ conversationId: "", message: "Hi" })).toBeNull();
  });

  it("rejects empty or non-string messages", () => {
    expect(
      parseChatRequest({ conversationId: VALID_ID, message: "   " })
    ).toBeNull();
    expect(
      parseChatRequest({ conversationId: VALID_ID, message: 42 })
    ).toBeNull();
    expect(parseChatRequest(null)).toBeNull();
    expect(parseChatRequest("nope")).toBeNull();
  });

  it("caps message length rather than rejecting long input", () => {
    const parsed = parseChatRequest({
      conversationId: VALID_ID,
      message: "a".repeat(DEFAULT_LIMITS.maxMessageLength + 500),
    });

    expect(parsed?.message).toHaveLength(DEFAULT_LIMITS.maxMessageLength);
  });

  it("honours a host's own message cap", () => {
    const parsed = parseChatRequest(
      { conversationId: VALID_ID, message: "a".repeat(100) },
      { maxMessageLength: 10 }
    );

    expect(parsed?.message).toHaveLength(10);
  });

  it("normalises the conversation id to lower case", () => {
    const parsed = parseChatRequest({
      conversationId: VALID_ID.toUpperCase(),
      message: "Hi",
    });

    expect(parsed?.conversationId).toBe(VALID_ID);
  });

  it("truncates an over-long page path", () => {
    const parsed = parseChatRequest({
      conversationId: VALID_ID,
      message: "Hi",
      pagePath: `/${"x".repeat(500)}`,
    });

    expect(parsed?.pagePath).toHaveLength(200);
  });

  it("still accepts the legacy turnstileToken key", () => {
    // A browser built against the original Cloudflare-only client must keep
    // working against a host that has never heard of Turnstile.
    const parsed = parseChatRequest({
      conversationId: VALID_ID,
      message: "Hi",
      turnstileToken: "legacy-token",
    });

    expect(parsed?.challengeToken).toBe("legacy-token");
  });

  it("prefers the current key when both are present", () => {
    const parsed = parseChatRequest({
      conversationId: VALID_ID,
      message: "Hi",
      challengeToken: "current",
      turnstileToken: "legacy",
    });

    expect(parsed?.challengeToken).toBe("current");
  });
});
