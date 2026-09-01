/**
 * Classifies why a chat turn failed.
 *
 * The visitor always sees a generic apology — billing state and key problems
 * must not leak onto a public page. This classification exists for the
 * operator: it decides what goes in the log, whether an alert is worth sending
 * immediately, and (for rate limits only) whether the visitor gets a more
 * useful "try again shortly".
 */
import { DEFAULT_MESSAGES, type ChatMessages } from "./config.js";

export type FailureKind =
  | "config"
  | "auth"
  | "billing"
  | "rate_limit"
  | "upstream"
  | "unknown";

export interface ClassifiedFailure {
  kind: FailureKind;
  status?: number;
  message: string;
  /** Persistent, operator-actionable problems worth an immediate email. */
  urgent: boolean;
}

const MAX_MESSAGE_LENGTH = 500;

export function classifyFailure(error: unknown): ClassifiedFailure {
  const status = readStatus(error);
  const message = readMessage(error).slice(0, MAX_MESSAGE_LENGTH);
  const lower = message.toLowerCase();

  // Billing failures arrive as a 400 (Anthropic: "credit balance is too low"),
  // a 429 (OpenAI/xAI: insufficient_quota) or a 402 (DeepSeek: "Insufficient
  // Balance"), so no status alone identifies them — match the message. The 402
  // is matched on status too, since that code means nothing else here.
  if (
    status === 402 ||
    lower.includes("credit balance") ||
    lower.includes("insufficient balance") ||
    lower.includes("billing") ||
    lower.includes("insufficient_quota") ||
    lower.includes("exceeded your current quota")
  ) {
    return { kind: "billing", status, message, urgent: true };
  }

  if (status === 401 || status === 403) {
    return { kind: "auth", status, message, urgent: true };
  }

  if (status === 429) {
    return { kind: "rate_limit", status, message, urgent: false };
  }

  if (status !== undefined && status >= 500) {
    return { kind: "upstream", status, message, urgent: false };
  }

  if (status === 400) {
    // A 400 that isn't billing is a request we built wrong — a deploy problem,
    // not a transient one.
    return { kind: "upstream", status, message, urgent: true };
  }

  return { kind: "unknown", status, message, urgent: false };
}

/** Message shown to the visitor. Never reveals the underlying cause. */
export function visitorMessage(
  failure: ClassifiedFailure,
  messages: Pick<
    ChatMessages,
    "upstreamRateLimited" | "genericFailure"
  > = DEFAULT_MESSAGES
): string {
  if (failure.kind === "rate_limit") {
    return messages.upstreamRateLimited;
  }

  return messages.genericFailure;
}

function readStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
}

function readMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return typeof error === "string" ? error : "Unknown error";
}
