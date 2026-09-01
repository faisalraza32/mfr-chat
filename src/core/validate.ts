import { DEFAULT_LIMITS, type ChatLimits } from "./config.js";
import type { ChatRequest } from "./types.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Longest `pagePath` kept. It is context for the transcript, not a route. */
const MAX_PAGE_PATH_LENGTH = 200;

export function parseChatRequest(
  payload: unknown,
  limits: Pick<ChatLimits, "maxMessageLength"> = DEFAULT_LIMITS
): ChatRequest | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const conversationId =
    typeof data.conversationId === "string" ? data.conversationId.trim() : "";
  const message =
    typeof data.message === "string"
      ? data.message.trim().slice(0, limits.maxMessageLength)
      : "";

  if (!UUID_PATTERN.test(conversationId) || !message) {
    return null;
  }

  return {
    conversationId: conversationId.toLowerCase(),
    message,
    // `turnstileToken` is the legacy key. Accepting both means a browser built
    // against the original Cloudflare-only client keeps working against a host
    // that has never heard of Turnstile.
    challengeToken:
      optionalString(data.challengeToken) ?? optionalString(data.turnstileToken),
    sessionToken: optionalString(data.sessionToken),
    pagePath: optionalString(data.pagePath)?.slice(0, MAX_PAGE_PATH_LENGTH),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
