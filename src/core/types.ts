/**
 * Wire and storage types shared by every layer of the core.
 *
 * These are deliberately free of any host runtime: no Cloudflare bindings, no
 * Node globals, no framework request objects. Everything that needs a host
 * lives behind a port in ./ports.ts.
 */

export interface ChatRequest {
  conversationId: string;
  message: string;
  /**
   * Proof a human is present, checked on the first message of a conversation.
   *
   * Named generically because the core does not care what issued it — the host
   * supplies a `HumanVerifier`. On the wire it is still accepted under the
   * legacy key `turnstileToken`, so a browser built against the original
   * Cloudflare-only implementation keeps working unchanged.
   */
  challengeToken?: string;
  /** Signed token issued after the first message passes the human check. */
  sessionToken?: string;
  /** Route the visitor was on, for context in the transcript. */
  pagePath?: string;
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
}

/** Emitted to the browser over SSE. */
export type ChatEvent =
  | { type: "session"; sessionToken: string }
  | { type: "delta"; text: string }
  | {
      type: "action";
      action: string;
      [key: string]: unknown;
    }
  | { type: "done" }
  | { type: "error"; error: string };

/**
 * Error codes the browser branches on.
 *
 * The prose changes with the copy; these do not. The names still say
 * "turnstile" because a shipped client already matches on them — renaming
 * would strand every open tab. Read them as "the human check".
 */
export const CHALLENGE_REQUIRED = "turnstile_required";
export const CHALLENGE_FAILED = "turnstile_failed";
