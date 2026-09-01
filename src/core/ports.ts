/**
 * The seams between the core and whatever is hosting it.
 *
 * Everything the core cannot do by itself — persist a conversation, count
 * requests per IP, prove a human is present, run work after the response —
 * arrives as one of these. A Cloudflare Worker implements them with D1 and
 * Turnstile; a Next.js route handler implements them with Prisma and its own
 * session. The core is identical in both.
 */
import type { ClassifiedFailure } from "./failures.js";
import type { StoredMessage } from "./types.js";

export interface ConversationState {
  exists: boolean;
  messageCount: number;
}

export interface ConversationMeta {
  pagePath?: string;
  country?: string;
}

/**
 * Conversation history lives here, not in the client payload.
 *
 * This is the load-bearing anti-abuse decision, and it is a contract on every
 * implementation of this interface: if the browser sent the history back on
 * each turn, anyone could post a fabricated 500k-token conversation and bill
 * the operator for it. The client sends only a conversation id.
 */
export interface ChatStore {
  getConversationState(conversationId: string): Promise<ConversationState>;
  /** Most recent `limit` messages, oldest first. */
  loadHistory(conversationId: string, limit: number): Promise<StoredMessage[]>;
  ensureConversation(
    conversationId: string,
    meta: ConversationMeta
  ): Promise<void>;
  recordTurn(
    conversationId: string,
    userMessage: string,
    assistantMessage: string
  ): Promise<void>;
}

export interface RateLimiter {
  /** True when this key has exceeded its allowance. Must not throw. */
  isLimited(key: string): Promise<boolean>;
}

/**
 * Proves a human is present. Omit it entirely and the core skips the challenge
 * and the session token with it — the right call behind an authenticated app,
 * where the visitor is already known.
 */
export type HumanVerifier = (
  token: string,
  ip: string | null
) => Promise<boolean>;

/**
 * Runs work that must outlive the response — persisting a turn, sending an
 * alert. `ctx.waitUntil` on Workers, `after()` on Next.js. The default awaits
 * nothing and lets the platform decide.
 */
export type BackgroundTask = (work: Promise<unknown>) => void;

export type FailureReporter = (failure: ClassifiedFailure) => void;

export interface RequestIdentity {
  /** Best-effort client IP, or "unknown". Used as the rate-limit key. */
  ip: string;
  country?: string;
}
