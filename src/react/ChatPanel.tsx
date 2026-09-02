"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cx } from "./class-names.js";
import { useChatUI } from "./context.js";
import { CloseIcon, SendIcon } from "./icons.js";
import { ChatMessageBubble } from "./ChatMessageBubble.js";
import type { ChatAction, ChatMessage } from "./types.js";
import type { UseChatResult } from "./use-chat.js";
import { useSheetViewport } from "./use-sheet-viewport.js";
import { isChatFullscreen } from "./viewport.js";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ChatPanelCopy {
  title: string;
  subtitle: string;
  greeting: string;
  placeholder: string;
  sendLabel: string;
  closeLabel: string;
  /** Shown under the input, alongside the privacy link. */
  disclosure: string;
  /** Link text for the privacy policy. Rendered only with a privacyHref. */
  privacyLabel?: string;
  retry: string;
  securityCheck: string;
  /** Shown when a message is sent before the widget has issued a token. */
  securityIncomplete: string;
}

export interface ChatPanelProps {
  copy: ChatPanelCopy;
  chat: UseChatResult;
  onClose: () => void;
  /** Renders whatever a tool asked the UI to show under a message. */
  renderAction?: (action: ChatAction, message: ChatMessage) => ReactNode;
  icons?: { send?: ReactNode; close?: ReactNode };
  maxLength?: number;
}

export function ChatPanel({
  copy,
  chat,
  onClose,
  renderAction,
  icons,
  maxLength = 2000,
}: ChatPanelProps) {
  const { classNames, Brand, Link, challenge, privacyHref, fullscreenQuery } =
    useChatUI();
  const {
    messages,
    sending,
    error,
    hasSession,
    challengeKey,
    send,
    reportError,
    clearError,
  } = chat;

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState("");
  const sheet = useSheetViewport(fullscreenQuery);

  const lastAssistantText =
    [...messages]
      .reverse()
      .find((message) => message.role === "assistant" && message.text)?.text ??
    "";

  // The challenge only needs to run until the conversation has a session token.
  const needsChallenge = Boolean(challenge?.isConfigured()) && !hasSession;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Mobile renders as a full-screen sheet, so the page behind it must not
  // scroll.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    if (isChatFullscreen(fullscreenQuery)) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreenQuery]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Pin to the newest message as tokens stream in — and again when the sheet
  // shrinks, so opening the keyboard doesn't leave the last reply above the
  // fold on a list that was already scrolled to the bottom.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;

    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [messages, sheet?.height]);

  const submit = () => {
    const form = formRef.current;

    if (!form || !draft.trim() || sending) {
      return;
    }

    const token = challenge?.readToken(form) ?? "";

    // The widget is on screen but unsolved — or was solved and has since
    // expired, and is busy issuing itself a new token. Say so rather than
    // swallowing the send and looking broken.
    if (needsChallenge && !token) {
      reportError(copy.securityIncomplete);
      return;
    }

    const text = draft;
    setDraft("");

    void send(text, token).then((outcome) => {
      // The security session lapsed, so this message was never accepted. Put
      // it back for the visitor rather than making them retype it — unless
      // they have already started typing something else.
      if (outcome === "challenge") {
        setDraft((current) => (current ? current : text));
      }
    });
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      className={classNames.panel}
      // On a phone the sheet is sized to the visual viewport rather than left
      // to `inset-0`, so the keyboard cannot push the header or the input row
      // off the screen. See useSheetViewport. Null above the breakpoint, where
      // the sm: classes own the layout.
      style={
        sheet
          ? {
              top: sheet.offsetTop,
              left: sheet.offsetLeft,
              width: sheet.width,
              height: sheet.height,
              right: "auto",
              bottom: "auto",
            }
          : undefined
      }
    >
      <header className={classNames.header}>
        <div className="flex min-w-0 items-center gap-2.5">
          {Brand ? (
            <span className={classNames.headerBrand}>
              <Brand />
            </span>
          ) : null}
          <div className="min-w-0">
            <p className={classNames.headerTitle}>{copy.title}</p>
            <p className={classNames.headerSubtitle}>{copy.subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.closeLabel}
          className={classNames.closeButton}
        >
          {icons?.close ?? <CloseIcon />}
        </button>
      </header>

      <div ref={scrollRef} className={classNames.scroller}>
        <ChatMessageBubble role="assistant" text={copy.greeting} />

        {messages.map((message) => (
          <div key={message.id} className="space-y-2">
            <ChatMessageBubble
              role={message.role}
              text={message.text}
              pending={sending && message.role === "assistant"}
            />
            {message.action && renderAction
              ? renderAction(message.action, message)
              : null}
          </div>
        ))}

        {/*
          Streamed replies are announced once settled rather than per token.
          Only assistant text belongs here — after a failed turn the last
          message is the visitor's own, and reading that back is confusing.
        */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {!sending ? lastAssistantText : ""}
        </div>

        {error ? (
          <div role="alert" className={classNames.errorText}>
            {error}{" "}
            <button
              type="button"
              onClick={clearError}
              className={classNames.errorRetry}
            >
              {copy.retry}
            </button>
          </div>
        ) : null}
      </div>

      <form
        ref={formRef}
        className={classNames.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {needsChallenge && challenge ? (
          <div className="mb-2">
            <p className={classNames.challengeHint}>{copy.securityCheck}</p>
            {/* Keyed so a lapsed session mounts a new widget instead of
              reusing one holding a token the issuer has already voided. */}
            {challenge.render({ challengeKey })}
          </div>
        ) : null}

        <div className={classNames.inputRow}>
          <label htmlFor="chat-input" className="sr-only">
            {copy.placeholder}
          </label>
          <textarea
            id="chat-input"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter makes a new line.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            maxLength={maxLength}
            placeholder={copy.placeholder}
            disabled={sending}
            className={classNames.input}
          />
          <button
            type="submit"
            aria-label={copy.sendLabel}
            disabled={sending || !draft.trim()}
            className={classNames.sendButton}
          >
            {icons?.send ?? <SendIcon />}
          </button>
        </div>

        <p className={classNames.disclosure}>
          {copy.disclosure}
          {privacyHref ? (
            <>
              {" "}
              <Link
                to={privacyHref}
                className={classNames.disclosureLink}
                onClick={onClose}
              >
                {copy.privacyLabel ?? "privacy policy"}
              </Link>
              .
            </>
          ) : null}
        </p>
      </form>
    </div>
  );
}

export { cx };
