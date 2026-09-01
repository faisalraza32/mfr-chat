// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { readChatStream } from "./parse-stream.js";
import type { ChatStreamEvent } from "./types.js";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(chunks: string[]): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];

  for await (const event of readChatStream(streamOf(chunks))) {
    events.push(event);
  }

  return events;
}

describe("readChatStream", () => {
  it("decodes complete frames", async () => {
    const events = await collect([
      'data: {"type":"delta","text":"Hi"}\n\n',
      'data: {"type":"done"}\n\n',
    ]);

    expect(events).toEqual([
      { type: "delta", text: "Hi" },
      { type: "done" },
    ]);
  });

  it("reassembles a frame split across chunk boundaries", async () => {
    // The realistic case: a network read lands mid-JSON.
    const events = await collect([
      'data: {"type":"del',
      'ta","text":"Hello"}\n',
      '\ndata: {"type":"done"}\n\n',
    ]);

    expect(events).toEqual([
      { type: "delta", text: "Hello" },
      { type: "done" },
    ]);
  });

  it("skips a malformed frame instead of aborting the stream", async () => {
    const events = await collect([
      "data: {not json}\n\n",
      'data: {"type":"done"}\n\n',
    ]);

    expect(events).toEqual([{ type: "done" }]);
  });

  it("passes booking actions through", async () => {
    const events = await collect([
      'data: {"type":"action","action":"booking","name":"Ada","email":"ada@example.com","topic":"App"}\n\n',
    ]);

    expect(events[0]).toMatchObject({
      type: "action",
      action: "booking",
      email: "ada@example.com",
    });
  });
});
