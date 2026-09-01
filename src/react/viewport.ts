/**
 * Below this width the chat panel is a full-screen sheet rather than a
 * floating card (see ChatPanel's `inset-0 sm:inset-auto` classes).
 *
 * Shared so the launcher and the panel cannot disagree about it. It lives here
 * rather than in ChatPanel because the launcher ships in the initial bundle and
 * must not pull the lazy-loaded panel in with it.
 */
export const CHAT_FULLSCREEN_QUERY = "(max-width: 639px)";

export function isChatFullscreen(
  query: string = CHAT_FULLSCREEN_QUERY
): boolean {
  return typeof window !== "undefined" && window.matchMedia(query).matches;
}
