// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatPanel, type ChatPanelCopy } from "./ChatPanel.js";
import { ChatUIProvider, type ChatChallenge } from "./context.js";
import type { ChatAction, ChatMessage, SendOutcome } from "./types.js";
import type { UseChatResult } from "./use-chat.js";

/**
 * The panel is the part of this package that is hard to rewrite: the focus
 * trap, Escape, the Enter/Shift+Enter split, and the rule that a message is
 * never sent past an unsolved challenge. None of that is visible in a type,
 * so it is pinned here.
 */

const COPY: ChatPanelCopy = {
  title: "Ask us",
  subtitle: "AI assistant",
  greeting: "Hi there.",
  placeholder: "Ask a question...",
  sendLabel: "Send message",
  closeLabel: "Close chat",
  disclosure: "AI assistant. See our",
  retry: "Try again",
  securityCheck: "Just checking you're human.",
  securityIncomplete: "Please finish the security check.",
};

function chatState(overrides: Partial<UseChatResult> = {}): UseChatResult {
  return {
    messages: [],
    sending: false,
    error: null,
    hasSession: true,
    challengeKey: 0,
    send: vi.fn(async (): Promise<SendOutcome> => "sent"),
    reportError: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  };
}

function renderPanel(
  chat: UseChatResult,
  {
    onClose = vi.fn(),
    challenge,
    renderAction,
    Brand,
  }: {
    onClose?: () => void;
    challenge?: ChatChallenge;
    renderAction?: (action: ChatAction, message: ChatMessage) => React.ReactNode;
    Brand?: React.ComponentType;
  } = {}
) {
  render(
    <ChatUIProvider config={{ challenge, internalPathPrefixes: [], Brand }}>
      <ChatPanel
        copy={COPY}
        chat={chat}
        onClose={onClose}
        renderAction={renderAction}
      />
    </ChatUIProvider>
  );

  return { onClose };
}

describe("ChatPanel", () => {
  it("is a labelled modal dialog carrying the greeting", () => {
    renderPanel(chatState());

    const dialog = screen.getByRole("dialog", { name: "Ask us" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Hi there.")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel(chatState());

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("sends on Enter and makes a new line on Shift+Enter", async () => {
    const user = userEvent.setup();
    const chat = chatState();
    renderPanel(chat);

    const input = screen.getByRole("textbox");

    await user.click(input);
    await user.keyboard("first{Shift>}{Enter}{/Shift}second");
    expect(chat.send).not.toHaveBeenCalled();
    expect(input).toHaveValue("first\nsecond");

    await user.keyboard("{Enter}");
    expect(chat.send).toHaveBeenCalledWith("first\nsecond", "");
  });

  it("does not send an empty or whitespace-only message", async () => {
    const user = userEvent.setup();
    const chat = chatState();
    renderPanel(chat);

    await user.click(screen.getByRole("textbox"));
    await user.keyboard("   {Enter}");

    expect(chat.send).not.toHaveBeenCalled();
  });
});

describe("the human check", () => {
  const solved: ChatChallenge = {
    isConfigured: () => true,
    render: () => <div data-testid="challenge" />,
    readToken: () => "solved-token",
  };

  const unsolved: ChatChallenge = { ...solved, readToken: () => "" };

  it("is hidden once the conversation has a session", () => {
    renderPanel(chatState({ hasSession: true }), { challenge: solved });

    expect(screen.queryByTestId("challenge")).toBeNull();
  });

  it("is shown while the conversation has none", () => {
    renderPanel(chatState({ hasSession: false }), { challenge: solved });

    expect(screen.getByTestId("challenge")).toBeInTheDocument();
    expect(screen.getByText(COPY.securityCheck)).toBeInTheDocument();
  });

  it("refuses to send past an unsolved challenge, and says so", async () => {
    const user = userEvent.setup();
    const chat = chatState({ hasSession: false });
    renderPanel(chat, { challenge: unsolved });

    await user.click(screen.getByRole("textbox"));
    await user.keyboard("Hello{Enter}");

    // Swallowing the send here is what made this look broken.
    expect(chat.send).not.toHaveBeenCalled();
    expect(chat.reportError).toHaveBeenCalledWith(COPY.securityIncomplete);
  });

  it("passes the solved token through to send", async () => {
    const user = userEvent.setup();
    const chat = chatState({ hasSession: false });
    renderPanel(chat, { challenge: solved });

    await user.click(screen.getByRole("textbox"));
    await user.keyboard("Hello{Enter}");

    expect(chat.send).toHaveBeenCalledWith("Hello", "solved-token");
  });

  it("is absent entirely when the host configures none", () => {
    // An authenticated app has no captcha to run and should not be made to
    // pretend otherwise.
    const chat = chatState({ hasSession: false });
    renderPanel(chat);

    expect(screen.queryByText(COPY.securityCheck)).toBeNull();
  });
});

describe("returning a refused message", () => {
  it("puts the text back in the box when the session lapsed", async () => {
    const user = userEvent.setup();
    const chat = chatState({
      send: vi.fn(async (): Promise<SendOutcome> => "challenge"),
    });
    renderPanel(chat);

    const input = screen.getByRole("textbox");
    await user.click(input);
    await act(async () => {
      await user.keyboard("Are you there?{Enter}");
    });

    // Making the visitor retype a message the server never accepted is the
    // worst possible response to an expiry they did nothing to cause.
    expect(input).toHaveValue("Are you there?");
  });

  it("leaves a newer draft alone", async () => {
    const user = userEvent.setup();
    let resolveSend: (outcome: SendOutcome) => void = () => {};
    const chat = chatState({
      send: vi.fn(
        () => new Promise<SendOutcome>((resolve) => (resolveSend = resolve))
      ),
    });
    renderPanel(chat);

    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.keyboard("First{Enter}");
    await user.keyboard("Something else");

    await act(async () => {
      resolveSend("challenge");
    });

    expect(input).toHaveValue("Something else");
  });
});

describe("tool actions", () => {
  it("renders whatever the host returns for an action, under its message", () => {
    const messages: ChatMessage[] = [
      {
        id: "1",
        role: "assistant",
        text: "Pick a time.",
        action: { action: "booking", name: "Ada" },
      },
    ];

    renderPanel(chatState({ messages }), {
      renderAction: (action) => (
        <button type="button">Book with {String(action.name)}</button>
      ),
    });

    expect(
      screen.getByRole("button", { name: "Book with Ada" })
    ).toBeInTheDocument();
  });

  it("renders nothing extra for a message with no action", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "assistant", text: "Just an answer." },
    ];
    const renderAction = vi.fn();

    renderPanel(chatState({ messages }), { renderAction });

    expect(renderAction).not.toHaveBeenCalled();
  });
});

describe("the brand mark", () => {
  it("is absent unless the host supplies one", () => {
    renderPanel(chatState());

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("brand")).toBeNull();
  });

  it("renders beside the title", () => {
    const Brand = () => <img data-testid="brand" src="/logo.svg" alt="" />;
    renderPanel(chatState(), { Brand });

    expect(screen.getByTestId("brand")).toBeInTheDocument();
    // Still one accessible name for the dialog — a mark carrying its own alt
    // text would have the screen reader say the brand twice.
    expect(screen.getByRole("dialog", { name: "Ask us" })).toBeInTheDocument();
  });

  it("is a component, so it may use hooks", () => {
    // A theme-aware logo has to read the current theme. Passing a node built
    // once at module scope could not; this is why the slot is a component.
    const Brand = () => {
      const [src] = useState("/logo-dark.svg");
      return <img data-testid="brand" src={src} alt="" />;
    };

    renderPanel(chatState(), { Brand });

    expect(screen.getByTestId("brand")).toHaveAttribute(
      "src",
      "/logo-dark.svg"
    );
  });
});
