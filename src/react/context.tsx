"use client";

import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";

import {
  resolveClassNames,
  type ChatClassNames,
} from "./class-names.js";
import { buildLinkPattern } from "./links.js";

/**
 * A router link. The package cannot import one: this site is on react-router
 * and the app is on Next, and picking either would exclude the other.
 *
 * Site paths must route client-side. A plain <a> would reload the whole app,
 * tearing down the chat mid-conversation to show a page the assistant only
 * suggested as further reading — so the default is only a fallback for hosts
 * with no router at all.
 */
export interface ChatLinkProps {
  to: string;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}

function FallbackLink({ to, className, onClick, children }: ChatLinkProps) {
  return (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

/**
 * The human check, if the host runs one.
 *
 * Modelled on how Turnstile actually behaves — a widget that mounts, issues a
 * token into the surrounding form, and must be remounted once that token is
 * spent — rather than on Turnstile itself. Omit it and the panel drops the
 * challenge UI entirely, which is what an authenticated app wants.
 */
export interface ChatChallenge {
  /** False when the host has a challenge configured but not enabled here. */
  isConfigured(): boolean;
  /** Rendered above the input while a challenge is outstanding. */
  render(props: { challengeKey: number }): ReactNode;
  /** Pulls the solved token out of the submitted form. */
  readToken(form: HTMLFormElement): string;
}

export interface ChatUIConfig {
  classNames?: Partial<ChatClassNames>;
  /** Your router's link component, adapted to ChatLinkProps. */
  Link?: ComponentType<ChatLinkProps>;
  /**
   * Path prefixes the assistant may link into, without leading slashes —
   * ["services", "blog"]. Anything else it emits stays plain text. See
   * links.ts: this is an allow-list, not a convenience.
   */
  internalPathPrefixes?: string[];
  challenge?: ChatChallenge;
  /** Where the disclosure line links. Omit to render the text alone. */
  privacyHref?: string;
  /** Media query below which the panel is a full-screen sheet. */
  fullscreenQuery?: string;
}

export interface ResolvedChatUI {
  classNames: ChatClassNames;
  Link: ComponentType<ChatLinkProps>;
  linkPattern: RegExp;
  challenge?: ChatChallenge;
  privacyHref?: string;
  fullscreenQuery?: string;
}

const ChatUIContext = createContext<ResolvedChatUI | null>(null);

export function ChatUIProvider({
  config,
  children,
}: {
  config: ChatUIConfig;
  children: ReactNode;
}) {
  const value: ResolvedChatUI = {
    classNames: resolveClassNames(config.classNames),
    Link: config.Link ?? FallbackLink,
    linkPattern: buildLinkPattern(config.internalPathPrefixes ?? []),
    challenge: config.challenge,
    privacyHref: config.privacyHref,
    fullscreenQuery: config.fullscreenQuery,
  };

  return (
    <ChatUIContext.Provider value={value}>{children}</ChatUIContext.Provider>
  );
}

export function useChatUI(): ResolvedChatUI {
  const value = useContext(ChatUIContext);

  if (!value) {
    throw new Error("Chat components must be rendered inside a ChatUIProvider.");
  }

  return value;
}
