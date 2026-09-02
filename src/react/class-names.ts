/**
 * Every styled slot in the panel.
 *
 * The components own structure, accessibility and behaviour; the host owns how
 * it looks. That split exists because the two apps this package serves do not
 * share a Tailwind vocabulary — one speaks shadcn's `bg-primary` /
 * `text-muted-foreground`, the other its own `bg-surface` / `text-muted` — and
 * a component hardcoding either is a component only one of them can use.
 *
 * The defaults are the shadcn set, so a shadcn app passes nothing.
 */
export interface ChatClassNames {
  panel: string;
  header: string;
  headerBrand: string;
  headerTitle: string;
  headerSubtitle: string;
  closeButton: string;
  scroller: string;
  form: string;
  challengeHint: string;
  inputRow: string;
  input: string;
  sendButton: string;
  disclosure: string;
  disclosureLink: string;
  errorText: string;
  errorRetry: string;
  bubbleRow: string;
  bubble: string;
  bubbleUser: string;
  bubbleAssistant: string;
  bubbleLink: string;
  typingDot: string;
  launcher: string;
}

export const defaultChatClassNames: ChatClassNames = {
  panel:
    "fixed z-50 flex flex-col overflow-hidden border border-border bg-background shadow-2xl " +
    "inset-0 sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[560px] sm:max-h-[calc(100vh-8rem)] sm:w-[380px] sm:rounded-2xl " +
    "motion-safe:animate-fade-up",
  header:
    "flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3",
  // shrink-0 so a long title squeezes the text, never the mark.
  headerBrand: "h-8 w-8 shrink-0",
  headerTitle: "truncate text-sm font-semibold",
  headerSubtitle: "truncate text-xs text-muted-foreground",
  closeButton:
    "rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
  // min-h-0 so this — and not the header or the input row — is what gives up
  // height when the keyboard shrinks the sheet. overscroll-contain stops a
  // swipe past the end of the thread scrolling the page behind.
  scroller:
    "min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4",
  form:
    "shrink-0 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3",
  challengeHint: "mb-1 text-xs text-muted-foreground",
  inputRow: "flex items-end gap-2",
  /*
    text-base is 16px, and that is load-bearing on mobile: iOS Safari zooms the
    page in when you focus a field smaller than 16px, which on a fixed
    full-screen sheet pans the close button off the right edge. Back to 14px
    from sm: up, where no browser does this.
  */
  input:
    "max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-border bg-muted px-4 py-3 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary disabled:opacity-60 sm:text-sm",
  sendButton:
    "mb-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40",
  disclosure: "mt-2 text-[11px] leading-relaxed text-muted-foreground",
  disclosureLink:
    "text-primary underline underline-offset-2 hover:text-primary/80",
  errorText: "text-sm text-destructive",
  errorRetry: "underline underline-offset-2",
  bubbleRow: "flex",
  bubble:
    "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
  bubbleUser: "bg-primary text-primary-foreground",
  bubbleAssistant: "bg-muted text-foreground",
  bubbleLink: "text-primary underline underline-offset-2 hover:text-primary/80",
  typingDot: "h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground",
  launcher:
    "fixed bottom-6 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:bg-primary/90 motion-safe:hover:scale-105",
};

export function resolveClassNames(
  overrides?: Partial<ChatClassNames>
): ChatClassNames {
  return { ...defaultChatClassNames, ...overrides };
}

/** Tiny local join; not worth a clsx dependency for a handful of slots. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
