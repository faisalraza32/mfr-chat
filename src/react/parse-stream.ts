import type { ChatStreamEvent } from "./types.js";

/**
 * Reads an SSE body and yields decoded events.
 *
 * Deliberately minimal: the server only ever emits `data:` lines, so there is
 * no need for a general-purpose SSE parser here.
 */
export async function* readChatStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // A frame is complete only at a blank line; anything after the last one
      // is a partial frame and must stay in the buffer.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const line = frame.trim();

        if (!line.startsWith("data:")) {
          continue;
        }

        try {
          yield JSON.parse(line.slice(5).trim()) as ChatStreamEvent;
        } catch {
          // A malformed frame shouldn't kill the whole stream.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
