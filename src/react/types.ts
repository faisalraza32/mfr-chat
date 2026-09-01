/**
 * What the browser half deals in.
 *
 * `ChatStreamEvent` mirrors `ChatEvent` in ../core/types.ts. It is restated
 * rather than imported so this entry point stays free of the core barrel,
 * which carries both model SDKs — see ../core/providers/metadata.ts for the
 * same reasoning applied to the provider labels.
 */

export type ChatStreamEvent =
  | { type: "session"; sessionToken: string }
  | { type: "delta"; text: string }
  | { type: "action"; action: string; [key: string]: unknown }
  | { type: "done" }
  | { type: "error"; error: string };

/**
 * An action the assistant asked the UI to render — a booking button, a form,
 * whatever the host's tools emit. The core passes the tool's own fields
 * through untouched, so this stays open.
 */
export interface ChatAction {
  action: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Set when the assistant emitted an action on this message. */
  action?: ChatAction;
}

/** What `send` did, so the caller can put an unsent message back in the box. */
export type SendOutcome = "sent" | "failed" | "challenge";
