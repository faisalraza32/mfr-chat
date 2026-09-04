// @vitest-environment jsdom
// fireEvent rather than userEvent: userEvent drives its own clock, and under
// the fake timers this file needs for the appearance delay it waits on one
// nobody advances. A click on a button needs none of that machinery.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatLauncher } from "./ChatLauncher.js";
import { ChatUIProvider } from "./context.js";
import { createChatStorage } from "./storage.js";

/**
 * The nudge beside the launcher, and the promise attached to closing it.
 *
 * The dismissal is the part worth testing. A bubble that returns after a
 * refresh has not been dismissed, it has been postponed, and that is the thing
 * people mean when they say they hate chat widgets — so it is pinned here,
 * including that it outlives the tab rather than only the page load.
 */

const COPY = {
  message: "Questions about what we build? Ask away.",
  dismissLabel: "Dismiss",
  openLabel: "Open the assistant",
};

const storage = createChatStorage("test:chat");

function mount(teaser: typeof COPY & { delayMs?: number } = COPY) {
  return render(
    <ChatUIProvider config={{ internalPathPrefixes: [] }}>
      <ChatLauncher
        storage={storage}
        launchLabel="Chat with us"
        closeLabel="Close chat"
        teaser={teaser}
        renderPanel={() => <div data-testid="panel" />}
      />
    </ChatUIProvider>,
  );
}

/** Past the delay, and past the frame the entry transition waits for. */
async function waitForTeaser() {
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  await act(async () => {
    vi.advanceTimersToNextFrame();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the launcher teaser", () => {
  it("waits before appearing", async () => {
    mount();

    // Arriving with the page reads as furniture and is ignored with everything
    // else above the fold.
    expect(screen.queryByText(COPY.message)).toBeNull();

    await waitForTeaser();
    expect(screen.getByText(COPY.message)).toBeInTheDocument();
  });

  it("stays away for good once dismissed, across a reload", async () => {
    const first = mount();
    await waitForTeaser();

    fireEvent.click(screen.getByRole("button", { name: COPY.dismissLabel }));
    expect(screen.queryByText(COPY.message)).toBeNull();

    // A reload is a fresh mount against the storage that survived it. The flag
    // is in localStorage, so closing the tab would not bring it back either.
    first.unmount();
    expect(localStorage.getItem(storage.keys.teaserDismissed)).toBe("1");

    mount();
    await waitForTeaser();
    expect(screen.queryByText(COPY.message)).toBeNull();
  });

  it("opens the panel when taken up, and does not come back after", async () => {
    const first = mount();
    await waitForTeaser();

    fireEvent.click(screen.getByRole("button", { name: COPY.openLabel }));

    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(screen.queryByText(COPY.message)).toBeNull();

    first.unmount();
    mount();
    await waitForTeaser();
    expect(screen.queryByText(COPY.message)).toBeNull();
  });

  it("says nothing to somebody who already has a conversation", async () => {
    // They have used the assistant. Selling it to them is noise.
    sessionStorage.setItem(storage.keys.conversation, crypto.randomUUID());

    mount();
    await waitForTeaser();

    expect(screen.queryByText(COPY.message)).toBeNull();
  });

  it("is absent entirely when the host configures none", async () => {
    render(
      <ChatUIProvider config={{ internalPathPrefixes: [] }}>
        <ChatLauncher
          storage={storage}
          launchLabel="Chat with us"
          closeLabel="Close chat"
          renderPanel={() => <div />}
        />
      </ChatUIProvider>,
    );

    await waitForTeaser();
    expect(screen.queryByText(COPY.message)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Chat with us" }),
    ).toBeInTheDocument();
  });

  it("keeps the dismiss reachable as its own control", async () => {
    mount();
    await waitForTeaser();

    // A button inside a button is invalid, and the browser resolves it by
    // dropping one — usually the dismiss, which is the half that matters.
    const dismiss = screen.getByRole("button", { name: COPY.dismissLabel });
    const body = screen.getByRole("button", { name: COPY.openLabel });

    expect(body.contains(dismiss)).toBe(false);
    expect(dismiss.contains(body)).toBe(false);
  });
});
