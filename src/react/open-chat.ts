/**
 * Lets a page ask for the chat panel to open.
 *
 * The launcher owns the panel's open state and is mounted once, above the
 * routed pages — so a page cannot reach it through props without threading
 * state through the layout. A window event keeps that boundary intact: the
 * page announces intent, the launcher decides what to do with it.
 *
 * Both helpers no-op without a window, so a page carrying a "try the
 * assistant" block can still be rendered by a build-time prerender.
 */

export const DEFAULT_OPEN_CHAT_EVENT = "chat:open";

export interface OpenChatChannel {
  eventName: string;
  request(): void;
  /** Returns an unsubscribe function, for use as an effect cleanup. */
  subscribe(handler: () => void): () => void;
}

export function createOpenChatChannel(
  eventName: string = DEFAULT_OPEN_CHAT_EVENT
): OpenChatChannel {
  return {
    eventName,

    request() {
      if (typeof window === "undefined") {
        return;
      }

      window.dispatchEvent(new CustomEvent(eventName));
    },

    subscribe(handler) {
      if (typeof window === "undefined") {
        return () => {};
      }

      window.addEventListener(eventName, handler);
      return () => window.removeEventListener(eventName, handler);
    },
  };
}
