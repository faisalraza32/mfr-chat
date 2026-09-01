// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { createOpenChatChannel } from "./open-chat.js";

describe("open-chat", () => {
  it("delivers a request to a subscriber", () => {
    const channel = createOpenChatChannel("test:open");
    const handler = vi.fn();
    const unsubscribe = channel.subscribe(handler);

    channel.request();

    expect(handler).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("stops delivering once unsubscribed", () => {
    const channel = createOpenChatChannel("test:open");
    const handler = vi.fn();

    channel.subscribe(handler)();
    channel.request();

    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers to every subscriber", () => {
    const channel = createOpenChatChannel("test:open");
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = channel.subscribe(first);
    const unsubscribeSecond = channel.subscribe(second);

    channel.request();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("keeps two channels with different names apart", () => {
    // Two apps on one origin must not open each other's panels.
    const mine = createOpenChatChannel("app-a:open");
    const theirs = createOpenChatChannel("app-b:open");
    const handler = vi.fn();

    const unsubscribe = mine.subscribe(handler);
    theirs.request();

    expect(handler).not.toHaveBeenCalled();
    unsubscribe();
  });
});
