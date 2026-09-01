// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  evaluateChatSession,
  IDLE_CHALLENGE_MS,
  IDLE_RESET_MS,
  readSessionExpiry,
} from "./session.js";

const NOW = 1_700_000_000_000;
const CONVERSATION = "3f1a7b2c-4d5e-4f60-8a91-2b3c4d5e6f70";

function token(expiresAt: number): string {
  return `${CONVERSATION}.${expiresAt}.c2lnbmF0dXJl`;
}

describe("readSessionExpiry", () => {
  it("reads the expiry the Worker signed into the token", () => {
    expect(readSessionExpiry(token(NOW + 1000))).toBe(NOW + 1000);
  });

  it("returns null for anything not shaped like a token", () => {
    for (const bad of [null, undefined, "", "a.b", "a.b.c.d", `${CONVERSATION}.later.sig`]) {
      expect(readSessionExpiry(bad)).toBeNull();
    }
  });
});

describe("evaluateChatSession", () => {
  it("is active while the token is in date and the visitor is present", () => {
    expect(
      evaluateChatSession({
        now: NOW,
        lastActivityAt: NOW - 60_000,
        sessionToken: token(NOW + 60 * 60 * 1000),
      })
    ).toBe("active");
  });

  it("challenges a first-time visitor with nothing stored", () => {
    expect(
      evaluateChatSession({ now: NOW, lastActivityAt: null, sessionToken: null })
    ).toBe("challenge");
  });

  it("challenges rather than sending a token the Worker has already expired", () => {
    expect(
      evaluateChatSession({
        now: NOW,
        lastActivityAt: NOW - 60_000,
        sessionToken: token(NOW - 1),
      })
    ).toBe("challenge");
  });

  it("challenges a token about to lapse in flight", () => {
    expect(
      evaluateChatSession({
        now: NOW,
        lastActivityAt: NOW - 60_000,
        sessionToken: token(NOW + 5_000),
      })
    ).toBe("challenge");
  });

  it("challenges after the idle window even with a valid token", () => {
    expect(
      evaluateChatSession({
        now: NOW,
        lastActivityAt: NOW - IDLE_CHALLENGE_MS,
        sessionToken: token(NOW + 60 * 60 * 1000),
      })
    ).toBe("challenge");
  });

  it("expires the conversation once the visitor has been away long enough", () => {
    expect(
      evaluateChatSession({
        now: NOW,
        lastActivityAt: NOW - IDLE_RESET_MS,
        sessionToken: token(NOW + 60 * 60 * 1000),
      })
    ).toBe("expired");
  });

  it("tolerates a clock that has moved backwards", () => {
    expect(
      evaluateChatSession({
        now: NOW,
        lastActivityAt: NOW + 60_000,
        sessionToken: token(NOW + 60 * 60 * 1000),
      })
    ).toBe("active");
  });
});
