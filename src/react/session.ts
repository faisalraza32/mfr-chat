/**
 * When a stored chat session stops being usable.
 *
 * The server mints a signed session token on the first message so the human
 * check runs once per conversation rather than once per message, and that
 * token carries its own expiry. The browser used to treat the token's mere
 * *presence* as proof of a live session, which is what stranded a returning
 * visitor: sessionStorage still held a token the server had already expired,
 * so the widget stayed hidden, every send came back "Please complete the
 * security check", and nothing on screen could clear it.
 *
 * So the client applies the same two questions the server does — is the token
 * still in date, and has this visitor been away — before deciding whether a
 * fresh challenge is needed.
 */

/** Away this long and the next message is challenged again. */
export const IDLE_CHALLENGE_MS = 30 * 60 * 1000;

/**
 * Away this long and the conversation itself is retired: new id, empty
 * transcript, fresh greeting. Matches the server's token TTL, past which the
 * thread could not be continued anyway.
 */
export const IDLE_RESET_MS = 2 * 60 * 60 * 1000;

/**
 * A token this close to expiring is treated as already gone. Sending one that
 * lapses in flight is exactly the failure this module exists to prevent.
 */
const EXPIRY_SKEW_MS = 60 * 1000;

export type ChatSessionStatus =
  /** Token in date and the visitor is still here — send straight through. */
  | "active"
  /** Transcript stands, but the next message needs a fresh challenge. */
  | "challenge"
  /** Gone stale enough to start over. */
  | "expired";

export interface ChatSessionInput {
  now: number;
  /** Epoch ms of the last message sent, or null if this tab has sent none. */
  lastActivityAt: number | null;
  sessionToken: string | null;
  idleChallengeMs?: number;
  idleResetMs?: number;
}

/**
 * The expiry the server signed into `conversationId.expiresAt.signature`, or
 * null if this is not a token shaped like one.
 *
 * Reading the expiry is not trusting it: the signature covers it, so a
 * tampered value fails verification server-side. The client only uses it to
 * avoid a round trip it already knows will be rejected.
 */
export function readSessionExpiry(
  token: string | null | undefined
): number | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const expiresAt = Number(parts[1]);

  return Number.isFinite(expiresAt) ? expiresAt : null;
}

export function evaluateChatSession({
  now,
  lastActivityAt,
  sessionToken,
  idleChallengeMs = IDLE_CHALLENGE_MS,
  idleResetMs = IDLE_RESET_MS,
}: ChatSessionInput): ChatSessionStatus {
  if (lastActivityAt !== null) {
    const idleFor = now - lastActivityAt;

    if (idleFor >= idleResetMs) {
      return "expired";
    }

    if (idleFor >= idleChallengeMs) {
      return "challenge";
    }
  }

  const expiresAt = readSessionExpiry(sessionToken);

  // No token yet is the ordinary state of a first-time visitor, and reads the
  // same as an expired one: challenge, then carry on.
  if (expiresAt === null || expiresAt - EXPIRY_SKEW_MS <= now) {
    return "challenge";
  }

  return "active";
}
