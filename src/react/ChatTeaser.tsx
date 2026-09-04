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

  useEffect(() => {
    const appear = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(appear);
  }, [delayMs]);

  if (!shown) return null;

  const mark = avatar ?? (Brand ? <Brand /> : null);

  /*
   * Rendered at full opacity, with no entrance of its own.
   *
   * The first version faded in from `opacity: 0` on the next animation frame,
   * which is wrong in a way that only shows up somewhere awkward:
   * `requestAnimationFrame` does not fire in a tab that is not painting, so a
   * page opened in a background tab — a middle click, a restored session — got
   * a teaser that was invisible and still focusable until something forced a
   * paint.
   *
   * In fairness that meant "until somebody looked at the tab", so nobody would
   * ever have seen the fault. It went anyway: a component that is invisible
   * unless a callback fires is one whose appearance you cannot reason about,
   * and it cost an hour of chasing a contrast problem that was not there.
   *
   * A host that wants it to arrive rather than appear puts an animation on
   * `classNames.teaser`, where the rest of its styling already lives.
   */
  return (
    <div className={classNames.teaser}>
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
