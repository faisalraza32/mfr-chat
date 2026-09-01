"use client";

import { useEffect, useState } from "react";

import { CHAT_FULLSCREEN_QUERY } from "./viewport.js";

/**
 * The area of the screen the visitor can actually see, for the mobile sheet.
 *
 * `position: fixed; inset: 0` resolves against the LAYOUT viewport, and the
 * layout viewport does not shrink when the on-screen keyboard opens. So the
 * sheet keeps its full height, its input row ends up behind the keyboard, and
 * the browser then scrolls the page to bring the caret into view — carrying the
 * header, and the close button with it, off the top of the screen.
 *
 * `visualViewport` reports the part that is genuinely visible, and it moves
 * with the keyboard on both iOS and Android. Tracking `offsetTop`/`offsetLeft`
 * as well as the size also keeps the sheet pinned to the visible region if the
 * browser pans or zooms for any other reason.
 *
 * Returns null on wider screens, where the panel is a floating card already
 * sized by CSS, and on browsers without the API — both keep the plain
 * `inset-0` sheet, which is the current behaviour.
 */
export interface SheetViewport {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
}

export function useSheetViewport(
  query: string = CHAT_FULLSCREEN_QUERY
): SheetViewport | null {
  const [sheet, setSheet] = useState<SheetViewport | null>(null);

  useEffect(() => {
    const visual = window.visualViewport;

    if (!visual) {
      return;
    }

    const media = window.matchMedia(query);

    const sync = () => {
      // Above the breakpoint the CSS card takes over, so hand control back
      // rather than leaving a stale inline height on a floating panel.
      //
      // A zero size is reported transiently by some browsers — during a
      // rotation, or while a backgrounded tab is being restored. Sizing the
      // sheet to it would blank the panel, so fall back to the CSS sheet and
      // wait for the next event, which carries real numbers.
      if (!media.matches || !visual.width || !visual.height) {
        setSheet(null);
        return;
      }

      setSheet((current) => {
        const next = {
          width: visual.width,
          height: visual.height,
          offsetTop: visual.offsetTop,
          offsetLeft: visual.offsetLeft,
        };

        // These events fire on every frame of a keyboard animation or a pan.
        // Returning the same object where nothing moved keeps React from
        // re-rendering the whole message list sixty times a second.
        return current &&
          current.width === next.width &&
          current.height === next.height &&
          current.offsetTop === next.offsetTop &&
          current.offsetLeft === next.offsetLeft
          ? current
          : next;
      });
    };

    sync();
    visual.addEventListener("resize", sync);
    visual.addEventListener("scroll", sync);
    media.addEventListener("change", sync);

    return () => {
      visual.removeEventListener("resize", sync);
      visual.removeEventListener("scroll", sync);
      media.removeEventListener("change", sync);
    };
  }, [query]);

  return sheet;
}
