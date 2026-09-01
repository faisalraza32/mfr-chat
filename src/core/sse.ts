import type { ChatEvent } from "./types.js";

const encoder = new TextEncoder();

export function encodeEvent(event: ChatEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Chat responses must never be cached or buffered by an intermediary.
  "X-Accel-Buffering": "no",
} as const;
