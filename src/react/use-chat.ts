"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { readChatStream } from "./parse-stream.js";
import { evaluateChatSession, type ChatSessionStatus } from "./session.js";
import type { ChatStorage } from "./storage.js";
import type { ChatAction, ChatMessage, SendOutcome } from "./types.js";

/** Error codes the server returns when the conversation must be re-verified. */
const CHALLENGE_CODES = new Set(["turnstile_required", "turnstile_failed"]);

export interface ChatErrorCopy {
  /** Generic failure, shown when nothing more specific applies. */
  error: string;
  /** Shown when the security session lapsed and the visitor must re-verify. */
  securityExpired: string;
}

export interface UseChatOptions {
  copy: ChatErrorCopy;
  storage: ChatStorage;
  /** Where to POST. Defaults to "/api/chat". */
  endpoint?: string;
  idleChallengeMs?: number;
  idleResetMs?: number;
  /**
   * Extra fields sent with every message. The page path goes here by default;
   * an app might add a workspace id.
   */
  metadata?: () => Record<string, unknown>;
  /**
   * Extra headers on every request, read fresh each time.
   *
   * A function rather than an object because the common case is a bearer token
   * that is refreshed while the panel is open: an object captured at mount
   * would keep sending the token the page loaded with, and start failing
   * silently an hour in.
   *
   * Cookie-authenticated apps need none of this — the browser attaches those
   * itself, and `fetch` is same-origin here.
   */
  headers?: () => Record<string, string>;
}

export interface UseChatResult {
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
  /** True once the visitor has passed the human check for this conversation. */
  hasSession: boolean;
  /**
   * Changes whenever a new challenge is required, so the caller can remount
   * the widget rather than reuse one holding a spent token.
   */
  challengeKey: number;
  send: (text: string, challengeToken?: string) => Promise<SendOutcome>;
  reportError: (message: string) => void;
  clearError: () => void;
}

export function useChat(options: UseChatOptions): UseChatResult {
  const {
    copy,
    storage,
    endpoint = "/api/chat",
    idleChallengeMs,
    idleResetMs,
    metadata,
    headers,
  } = options;

  const KEYS = storage.keys;
  const errorCopy = copy.error;
  const expiredCopy = copy.securityExpired;

  /**
   * The visible transcript, restored after a navigation.
   *
   * The server keeps the authoritative history and never trusts the client's
   * copy, so this is presentation only — a mangled or stale value can lose the
   * visitor's view of the thread but cannot corrupt what the model is sent.
   */
  const readStoredMessages = useCallback((): ChatMessage[] => {
    const raw = storage.read(KEYS.messages);

    if (!raw) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(
        (entry): entry is ChatMessage =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as ChatMessage).role !== undefined &&
          typeof (entry as ChatMessage).text === "string"
      );
    } catch {
      return [];
    }
  }, [KEYS.messages, storage]);

  const readActivity = useCallback((): number | null => {
    const raw = storage.read(KEYS.activity);
    const parsed = raw === null ? Number.NaN : Number(raw);

    return Number.isFinite(parsed) ? parsed : null;
  }, [KEYS.activity, storage]);

  const markActivity = useCallback((): void => {
    storage.write(KEYS.activity, String(Date.now()));
  }, [KEYS.activity, storage]);

  const readSessionStatus = useCallback(
    (): ChatSessionStatus =>
      evaluateChatSession({
        now: Date.now(),
        lastActivityAt: readActivity(),
        sessionToken: storage.read(KEYS.session),
        idleChallengeMs,
        idleResetMs,
      }),
    [KEYS.session, idleChallengeMs, idleResetMs, readActivity, storage]
  );

  /** Retires the conversation itself, not just the security session. */
  const clearConversation = useCallback((): void => {
    storage.remove(KEYS.conversation);
    storage.remove(KEYS.session);
    storage.remove(KEYS.messages);
    storage.remove(KEYS.activity);
  }, [KEYS, storage]);

  /** Kept in sessionStorage so a navigation or reload continues the thread. */
  const getConversationId = useCallback((): string => {
    const existing = storage.read(KEYS.conversation);

    if (existing) {
      return existing;
    }

    const created = crypto.randomUUID();
    storage.write(KEYS.conversation, created);
    return created;
  }, [KEYS.conversation, storage]);

  /**
   * Applies the idle rules to whatever this tab has stored, before the first
   * render, so a visitor returning to a stale thread sees the security check
   * rather than an error they cannot clear.
   */
  const [restored] = useState(() => {
    const status = readSessionStatus();

    if (status === "expired") {
      clearConversation();
      // Everything it referred to is gone, so this tab is now
      // indistinguishable from a first visit: one challenge away from a
      // working conversation.
      return { status: "challenge" as ChatSessionStatus, messages: [] };
    }

    if (status === "challenge") {
      // The transcript stays; only the proof of a human does not.
      storage.remove(KEYS.session);
    }

    return { status, messages: readStoredMessages() };
  });

  const [messages, setMessages] = useState<ChatMessage[]>(restored.messages);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(restored.status === "active");
  const [challengeKey, setChallengeKey] = useState(0);
  const conversationIdRef = useRef<string | null>(null);
  const statusRef = useRef<ChatSessionStatus>(restored.status);

  // Persist the transcript so a real page load does not lose it. The empty
  // placeholder bubble shown while the model is still thinking is not worth
  // restoring.
  useEffect(() => {
    const persistable = messages.filter((message) => message.text);

    storage.write(KEYS.messages, JSON.stringify(persistable));
  }, [KEYS.messages, messages, storage]);

  /**
   * Retires the conversation — id, transcript, token — and returns the hook to
   * its first-visit state.
   */
  const expireConversation = useCallback(() => {
    clearConversation();
    conversationIdRef.current = null;
    statusRef.current = "challenge";
    setMessages([]);
    setHasSession(false);
  }, [clearConversation]);

  /** Drops the security session and puts a fresh widget on screen. */
  const requireChallenge = useCallback(() => {
    storage.remove(KEYS.session);
    statusRef.current = "challenge";
    setHasSession(false);
    setChallengeKey((current) => current + 1);
  }, [KEYS.session, storage]);

  /**
   * Re-applies the idle rules when the visitor comes back to the tab.
   *
   * The session can lapse while nothing is running — the visitor switches away
   * for an hour and returns to a panel whose React state still says it is
   * verified. `pageshow` covers the back/forward cache, where the whole heap is
   * restored and no other event necessarily fires.
   */
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      const status = readSessionStatus();

      // Only act on a transition: re-running this while already challenged
      // would throw away a challenge the visitor has just solved.
      if (status === statusRef.current) {
        return;
      }

      if (status === "expired") {
        expireConversation();
        setError(null);
        // The widget, if one is on screen, is holding a token that lapsed a
        // long time ago. Replace it.
        setChallengeKey((current) => current + 1);
        return;
      }

      if (status === "active") {
        statusRef.current = status;
        setHasSession(true);
        return;
      }

      requireChallenge();
    };

    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("pageshow", recheck);

    return () => {
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("pageshow", recheck);
    };
  }, [expireConversation, readSessionStatus, requireChallenge]);

  const clearError = useCallback(() => setError(null), []);
  const reportError = useCallback((message: string) => setError(message), []);

  const send = useCallback(
    async (text: string, challengeToken?: string): Promise<SendOutcome> => {
      const trimmed = text.trim();

      if (!trimmed || sending) {
        return "failed";
      }

      // An idle gap that lapsed while the panel sat open is caught here too,
      // not only on the way back into the tab.
      // A challenge the visitor has just solved is deliberately left alone:
      // the fresh conversation can be opened with it.
      if (readSessionStatus() === "expired") {
        expireConversation();
      }

      conversationIdRef.current ??= getConversationId();
      setError(null);
      setSending(true);
      markActivity();

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmed,
      };
      const assistantId = crypto.randomUUID();

      setMessages((current) => [
        ...current,
        userMessage,
        { id: assistantId, role: "assistant", text: "" },
      ]);

      const updateAssistant = (update: Partial<ChatMessage>) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, ...update } : message
          )
        );
      };

      let outcome: SendOutcome = "failed";

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(headers?.() ?? {}),
          },
          body: JSON.stringify({
            conversationId: conversationIdRef.current,
            message: trimmed,
            challengeToken: challengeToken || undefined,
            sessionToken: storage.read(KEYS.session) ?? undefined,
            ...(metadata?.() ?? {}),
          }),
        });

        if (!response.ok || !response.body) {
          // Errors come back as JSON, not SSE.
          const result = (await response
            .json()
            .catch(() => null)) as { error?: string; code?: string } | null;

          // The server has rejected the security session — most often one that
          // expired while the visitor was away. Put the widget back so the
          // conversation can recover instead of failing on every attempt.
          if (result?.code && CHALLENGE_CODES.has(result.code)) {
            outcome = "challenge";
            throw new Error(expiredCopy);
          }

          throw new Error(result?.error ?? errorCopy);
        }

        let streamed = "";

        for await (const event of readChatStream(response.body)) {
          if (event.type === "session") {
            storage.write(KEYS.session, event.sessionToken);
            statusRef.current = "active";
            setHasSession(true);
          } else if (event.type === "delta") {
            streamed += event.text;
            updateAssistant({ text: streamed });
          } else if (event.type === "action") {
            const { type: _type, ...action } = event;

            updateAssistant({ action: action as ChatAction });
          } else if (event.type === "error") {
            throw new Error(event.error);
          }
        }

        if (!streamed) {
          throw new Error(errorCopy);
        }

        outcome = "sent";
        markActivity();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : errorCopy);

        if (outcome === "challenge") {
          requireChallenge();
        }

        // Drop the empty assistant bubble so the transcript isn't left with a
        // blank turn under the error. A message the server never accepted goes
        // with it — the caller puts that text back in the input box.
        setMessages((current) =>
          current.filter(
            (message) =>
              !(message.id === assistantId && !message.text) &&
              !(outcome === "challenge" && message.id === userMessage.id)
          )
        );
      } finally {
        setSending(false);
      }

      return outcome;
    },
    [
      KEYS.session,
      endpoint,
      errorCopy,
      expiredCopy,
      expireConversation,
      getConversationId,
      headers,
      markActivity,
      metadata,
      readSessionStatus,
      requireChallenge,
      sending,
      storage,
    ]
  );

  return {
    messages,
    sending,
    error,
    hasSession,
    challengeKey,
    send,
    reportError,
    clearError,
  };
}
