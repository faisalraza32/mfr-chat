/**
 * Everything that used to be a module constant or a hardcoded string.
 *
 * The originals were fine while there was one site. With two hosts, a limit
 * baked into a module is a limit the second host cannot change without a fork,
 * so they all become overridable — with the same defaults the original ran on.
 */

export interface ChatLimits {
  /** Longest visitor message accepted, in characters. */
  maxMessageLength: number;
  /** Hard ceiling on turns per conversation, enforced against the store. */
  maxMessagesPerConversation: number;
  /** How many prior turns are replayed to the model. */
  historyTurnLimit: number;
  /**
   * How close to the per-conversation cap before the assistant starts steering
   * toward a next step.
   *
   * Hitting the cap mid-conversation ends with a flat "please email us", and
   * the visitors who get there are the most engaged ones. This gives it a few
   * turns to offer a call or take a message first.
   */
  wrapUpAtRemaining: number;
  /** Guards against a tool loop that never settles on an answer. */
  maxToolIterations: number;
}

export const DEFAULT_LIMITS: ChatLimits = {
  maxMessageLength: 2000,
  maxMessagesPerConversation: 20,
  historyTurnLimit: 20,
  wrapUpAtRemaining: 5,
  maxToolIterations: 4,
};

export interface SessionOptions {
  /** How long an issued session token stays valid. */
  ttlMs: number;
  /**
   * How much life a token must have left to be worth keeping.
   *
   * A conversation that stays busy past the TTL would otherwise hit the expiry
   * mid-thread and be told to complete a check it has already passed, so a
   * token this close to the end is replaced on the next turn.
   */
  refreshBeforeMs: number;
}

export const DEFAULT_SESSION: SessionOptions = {
  ttlMs: 2 * 60 * 60 * 1000,
  refreshBeforeMs: 30 * 60 * 1000,
};

/**
 * Every string a visitor can be shown by the core.
 *
 * The defaults are deliberately generic: no company name, no support address,
 * no booking link. A host that wants to point somewhere specific overrides the
 * two or three that matter — see `conversationLimit` and `genericFailure`.
 */
export interface ChatMessages {
  /** A required secret is missing; the endpoint is refusing to run. */
  unavailable: string;
  /** The request body was not JSON. */
  invalidBody: string;
  /** The body parsed but failed validation. */
  invalidRequest: string;
  /** This client is sending faster than the limiter allows. */
  rateLimited: string;
  /** This conversation has used all its turns. */
  conversationLimit: string;
  /** No valid session and no challenge token supplied. */
  challengeRequired: string;
  /** A challenge token was supplied and the verifier rejected it. */
  challengeFailed: string;
  /** The model provider is rate limiting us. Distinct from `rateLimited`. */
  upstreamRateLimited: string;
  /** Anything else that went wrong upstream. Never names the cause. */
  genericFailure: string;
  /** The tool loop ran out of iterations without producing an answer. */
  toolLoopExhausted: string;
}

export const DEFAULT_MESSAGES: ChatMessages = {
  unavailable: "The assistant is unavailable right now.",
  invalidBody: "Invalid request body.",
  invalidRequest: "Please check your message and try again.",
  rateLimited:
    "You're sending messages faster than I can answer. Give it a moment.",
  conversationLimit:
    "This conversation has reached its length limit. Please start a new one, or get in touch another way.",
  challengeRequired: "Please complete the security check.",
  challengeFailed: "Security check failed. Please try again.",
  upstreamRateLimited:
    "I'm getting a lot of questions right now. Give it a moment and try again.",
  genericFailure: "Something went wrong on my end. Please try again.",
  toolLoopExhausted: "Sorry — I got stuck on that one. Please try rephrasing.",
};

export function resolveLimits(overrides?: Partial<ChatLimits>): ChatLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}

export function resolveMessages(
  overrides?: Partial<ChatMessages>
): ChatMessages {
  return { ...DEFAULT_MESSAGES, ...overrides };
}

export function resolveSession(
  overrides?: Partial<SessionOptions>
): SessionOptions {
  return { ...DEFAULT_SESSION, ...overrides };
}
