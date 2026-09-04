"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { ChatTeaser, type ChatTeaserCopy } from "./ChatTeaser.js";
import { useChatUI } from "./context.js";
import { ChatIcon } from "./icons.js";
import type { OpenChatChannel } from "./open-chat.js";
import type { ChatStorage } from "./storage.js";
import { isChatFullscreen } from "./viewport.js";

export interface ChatLauncherProps {
  storage: ChatStorage;
  launchLabel: string;
  closeLabel: string;
  /**
   * Renders the panel when open. A render prop rather than a component so the
   * host owns the lazy boundary: only the button belongs in the initial
   * bundle, and the host knows how its bundler splits.
   */
  renderPanel: (props: { onClose: () => void }) => ReactNode;
  /**
   * A string that changes on navigation — usually `pathname + hash`. The host
   * reads it from its own router; the package only needs to know it moved.
   */
  routeKey?: string;
  /** Lets a page ask for the panel. Omit and nothing can open it but a click. */
  openChannel?: OpenChatChannel;
  icon?: ReactNode;
  /**
   * A nudge beside the button, a few seconds after the page settles.
   *
   * Omit it and there is none. Dismissing it is remembered past the tab, and a
   * conversation that already exists suppresses it — somebody who has used the
   * assistant does not need selling it.
   */
  teaser?: ChatTeaserCopy & { delayMs?: number };
}

export function ChatLauncher({
  storage,
  launchLabel,
  closeLabel,
  renderPanel,
  routeKey,
  openChannel,
  icon,
  teaser,
}: ChatLauncherProps) {
  const { classNames, fullscreenQuery } = useChatUI();

  // Restored from the tab's session so the panel survives a real page load —
  // an external link, a refresh, a typed URL — where React state starts from
  // nothing. In-app navigation keeps this component mounted.
  const [open, setOpen] = useState(
    () => storage.read(storage.keys.open) === "1"
  );
  const launcherRef = useRef<HTMLButtonElement>(null);

  /**
   * Whether the nudge has anything left to say.
   *
   * Suppressed by a previous dismissal, by the panel being open, and by a
   * conversation already existing in this tab — three separate ways of having
   * been answered already.
   */
  const [teaserDone, setTeaserDone] = useState(
    () =>
      storage.readDurable(storage.keys.teaserDismissed) === "1" ||
      storage.read(storage.keys.conversation) !== null,
  );

  const dismissTeaser = () => {
    storage.writeDurable(storage.keys.teaserDismissed, "1");
    setTeaserDone(true);
  };

  const toggle = () =>
    setOpen((current) => {
      const next = !current;

      storage.write(storage.keys.open, next ? "1" : "0");
      return next;
    });

  // On a phone the panel covers the whole screen, so leaving it open after the
  // visitor follows a link hides the page they just asked to see. Close it and
  // leave the thread in place; reopening restores it. On a wider screen the
  // panel is a floating card, so it stays open and keeps its context.
  const initialRoute = useRef(true);

  useEffect(() => {
    // The effect also runs on mount, where there has been no navigation —
    // closing there would stop the panel ever being restored after a reload.
    if (initialRoute.current) {
      initialRoute.current = false;
      return;
    }

    if (!isChatFullscreen(fullscreenQuery)) {
      return;
    }

    setOpen((current) => {
      if (current) {
        storage.write(storage.keys.open, "0");
      }

      return false;
    });
  }, [fullscreenQuery, routeKey, storage]);

  // A page can ask for the panel — a service page might offer the assistant as
  // a live demo of what it describes. Already-open is a no-op rather than a
  // toggle, so a second click doesn't close it.
  useEffect(
    () =>
      openChannel?.subscribe(() => {
        setOpen(true);
        storage.write(storage.keys.open, "1");
      }),
    [openChannel, storage]
  );

  const close = () => {
    setOpen(false);
    storage.remove(storage.keys.open);
    // Return focus to where it came from, per dialog conventions.
    launcherRef.current?.focus();
  };

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={toggle}
        aria-label={open ? closeLabel : launchLabel}
        aria-expanded={open}
        className={classNames.launcher}
      >
        {icon ?? <ChatIcon />}
      </button>

      {teaser && !teaserDone && !open ? (
        <ChatTeaser
          copy={teaser}
          delayMs={teaser.delayMs}
          onDismiss={dismissTeaser}
          onOpen={() => {
            // Taken up rather than refused, but either way it has done its job
            // and should not return when the panel closes.
            dismissTeaser();
            setOpen(true);
            storage.write(storage.keys.open, "1");
          }}
        />
      ) : null}

      {open ? renderPanel({ onClose: close }) : null}
    </>
  );
}
