"use client";

import { useEffect, useState, type ReactNode } from "react";

import { useChatUI } from "./context.js";
import { CloseIcon } from "./icons.js";

export interface ChatTeaserCopy {
  /** One or two short sentences. It is a nudge, not a paragraph. */
  message: string;
  /** Accessible name for the dismiss control. */
  dismissLabel: string;
  /** Accessible name for the message itself, which opens the panel. */
  openLabel?: string;
}

export interface ChatTeaserProps {
  copy: ChatTeaserCopy;
  onOpen: () => void;
  onDismiss: () => void;
  /**
   * How long to wait before it appears. Arriving with the page reads as part
   * of the furniture and gets ignored with everything else above the fold;
   * arriving a few seconds later reads as an offer.
   */
  delayMs?: number;
  /** Defaults to the configured `Brand`, if there is one. */
  avatar?: ReactNode;
}

/**
 * The nudge beside the launcher: a line of copy, and a way to refuse it.
 *
 * The dismiss control is the point. An unclosable bubble that returns on every
 * page is the thing people mean when they say they hate chat widgets, so this
 * one closes, and closing it is remembered past the tab — see `writeDurable`.
 */
export function ChatTeaser({
  copy,
  onOpen,
  onDismiss,
  delayMs = 4000,
  avatar,
}: ChatTeaserProps) {
  const { classNames, Brand } = useChatUI();
  const [shown, setShown] = useState(false);
  const [settled, setSettled] = useState(false);
  // Read once rather than watched: this decides how one element arrives, and
  // somebody changing the setting mid-animation is not a case worth a listener.
  const [still] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const appear = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(appear);
  }, [delayMs]);

  // A frame after mounting, so the transition has two states to move between
  // rather than starting at its destination.
  useEffect(() => {
    if (!shown) return;

    const frame = window.requestAnimationFrame(() => setSettled(true));
    return () => window.cancelAnimationFrame(frame);
  }, [shown]);

  if (!shown) return null;

  const mark = avatar ?? (Brand ? <Brand /> : null);

  return (
    <div
      className={classNames.teaser}
      style={
        still
          ? undefined
          : {
              opacity: settled ? 1 : 0,
              transform: settled ? "none" : "translateY(6px)",
              transition: "opacity 220ms ease-out, transform 220ms ease-out",
            }
      }
    >
      {/*
        Two sibling buttons rather than one containing the other: a button
        inside a button is invalid, and browsers resolve it by dropping one —
        usually the dismiss, which is the half that matters.
      */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={copy.openLabel}
        className={classNames.teaserBody}
      >
        {mark ? <span className="h-7 w-7 shrink-0">{mark}</span> : null}
        <span className={classNames.teaserText}>{copy.message}</span>
      </button>

      <button
        type="button"
        onClick={onDismiss}
        aria-label={copy.dismissLabel}
        className={classNames.teaserDismiss}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
