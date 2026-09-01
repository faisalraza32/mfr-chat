import { describe, expect, it } from "vitest";

import { DEFAULT_SESSION } from "./config.js";
import {
  issueSessionToken,
  readSessionExpiry,
  shouldRefreshSessionToken,
  verifySessionToken,
} from "./session.js";

const SECRET = "test-secret-value-that-is-long-enough";
const CONVERSATION = "3f1a7b2c-4d5e-4f60-8a91-2b3c4d5e6f70";
const OTHER = "9c8b7a6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";

describe("chat session tokens", () => {
  it("verifies a token it just issued", async () => {
    const token = await issueSessionToken(SECRET, CONVERSATION);
    await expect(verifySessionToken(SECRET, token, CONVERSATION)).resolves.toBe(
      true
    );
  });

  it("rejects a token bound to a different conversation", async () => {
    const token = await issueSessionToken(SECRET, CONVERSATION);
    await expect(verifySessionToken(SECRET, token, OTHER)).resolves.toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await issueSessionToken(SECRET, CONVERSATION);
    await expect(
      verifySessionToken("a-different-secret", token, CONVERSATION)
    ).resolves.toBe(false);
  });

  it("rejects an expired token", async () => {
    const issuedAt = Date.now() - 3 * 60 * 60 * 1000; // 3h ago, TTL is 2h
    const token = await issueSessionToken(SECRET, CONVERSATION, {
      now: issuedAt,
    });
    await expect(verifySessionToken(SECRET, token, CONVERSATION)).resolves.toBe(
      false
    );
  });

  it("rejects a token whose expiry has been extended", async () => {
    const token = await issueSessionToken(SECRET, CONVERSATION);
    const [conversationId, , signature] = token.split(".");
    const forged = [
      conversationId,
      String(Date.now() + 10 * 60 * 60 * 1000),
      signature,
    ].join(".");

    await expect(
      verifySessionToken(SECRET, forged, CONVERSATION)
    ).resolves.toBe(false);
  });

  it("leaves a freshly issued token alone", async () => {
    const token = await issueSessionToken(SECRET, CONVERSATION);
    expect(shouldRefreshSessionToken(token)).toBe(false);
  });

  it("refreshes a token nearing its expiry rather than letting it lapse", async () => {
    // Issued long enough ago that under an hour is left of the two.
    const token = await issueSessionToken(SECRET, CONVERSATION, {
      now: Date.now() - DEFAULT_SESSION.ttlMs + 10 * 60 * 1000,
    });

    expect(shouldRefreshSessionToken(token)).toBe(true);
  });

  it("rejects malformed tokens without throwing", async () => {
    for (const bad of ["", "a.b", "a.b.c.d", "not-a-token"]) {
      await expect(verifySessionToken(SECRET, bad, CONVERSATION)).resolves.toBe(
        false
      );
    }
  });

  it("honours a custom TTL", async () => {
    const token = await issueSessionToken(SECRET, CONVERSATION, {
      ttlMs: 60 * 1000,
      now: 1_000_000,
    });

    expect(readSessionExpiry(token)).toBe(1_060_000);
  });

  it("reads an expiry off a token without trusting it, and nothing off junk", () => {
    expect(readSessionExpiry(null)).toBeNull();
    expect(readSessionExpiry("a.b")).toBeNull();
    expect(readSessionExpiry("id.notanumber.sig")).toBeNull();
    expect(readSessionExpiry("id.1234.sig")).toBe(1234);
  });
});
