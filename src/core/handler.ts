/**
 * The whole turn, from a `Request` to a streaming `Response`.
 *
 * Both Cloudflare Workers and Next.js route handlers speak the Fetch API, so
 * this signature is the same in either host. What differs — the database, the
 * rate limiter, the human check, how background work is scheduled — arrives
 * through ports.
 */
import {
  resolveLimits,
  resolveMessages,
  resolveSession,
  type ChatLimits,
  type ChatMessages,
  type SessionOptions,
} from "./config.js";
import { classifyFailure, visitorMessage } from "./failures.js";
import type {
  BackgroundTask,
  ChatStore,
  FailureReporter,
  HumanVerifier,
  RateLimiter,
  RequestIdentity,
} from "./ports.js";
import type { ChatProvider } from "./providers/types.js";
import { runChatTurn } from "./run.js";
import {
  issueSessionToken,
  shouldRefreshSessionToken,
  verifySessionToken,
} from "./session.js";
import { encodeEvent, SSE_HEADERS } from "./sse.js";
import type { ChatToolset } from "./tools.js";
import { CHALLENGE_FAILED, CHALLENGE_REQUIRED, type ChatEvent } from "./types.js";
import { parseChatRequest } from "./validate.js";

export interface ChatHandlerDeps<Ctx> {
  /**
   * The provider, or a factory for it. A factory is preferred: it is called
   * inside the streaming body, so a missing key becomes a classified failure
   * the visitor sees as an apology rather than a 500 with no explanation.
   */
  provider: ChatProvider | (() => ChatProvider);
  store: ChatStore;
  toolset: ChatToolset<Ctx>;
  toolContext: Ctx;
  guardrails: string;
  knowledge: string;

  /**
   * Secret for the session HMAC. Required whenever `verifyHuman` is set —
   * without a human check there is no session to sign.
   */
  sessionSecret?: string;
  /**
   * Omit to skip the challenge and the session token entirely. That is the
   * right call behind an authenticated app, where the visitor is already
   * known; a public marketing site should always supply one.
   */
  verifyHuman?: HumanVerifier;

  rateLimiter?: RateLimiter;
  runInBackground?: BackgroundTask;
  reportFailure?: FailureReporter;

  /**
   * Reads the client IP and country off the request. Defaults to Cloudflare's
   * `CF-Connecting-IP`, falling back to `X-Forwarded-For`.
   */
  identify?: (request: Request) => RequestIdentity;

  /**
   * Checked before anything else. Return the name of a missing secret to
   * refuse the request with a 503 and an urgent alert — a missing secret
   * breaks every request, so it is worth an alert rather than a log line
   * nobody reads. Return null when everything is present.
   */
  preflight?: () => string | null;

  limits?: Partial<ChatLimits>;
  messages?: Partial<ChatMessages>;
  session?: Partial<SessionOptions>;
}

/**
 * `code` is what the browser branches on. The prose changes with the copy; the
 * code does not, and the chat panel uses it to tell "your session lapsed, here
 * is the widget again" apart from a failure it cannot recover from on its own.
 */
function errorResponse(error: string, status: number, code?: string): Response {
  return Response.json({ ok: false, error, code }, { status });
}

function defaultIdentify(request: Request): RequestIdentity {
  const ip =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown";
  const country =
    (request as { cf?: { country?: string } }).cf?.country ??
    request.headers.get("CF-IPCountry") ??
    undefined;

  return { ip, country: country ?? undefined };
}

export async function handleChatRequest<Ctx>(
  request: Request,
  deps: ChatHandlerDeps<Ctx>
): Promise<Response> {
  const limits = resolveLimits(deps.limits);
  const messages = resolveMessages(deps.messages);
  const session = resolveSession(deps.session);
  const runInBackground: BackgroundTask =
    deps.runInBackground ?? ((work) => void work.catch(() => {}));

  const reportFailure = (failure: Parameters<FailureReporter>[0]) => {
    deps.reportFailure?.(failure);
  };

  const missingSecret = deps.preflight?.() ?? null;

  if (missingSecret) {
    console.error(`${missingSecret} is not configured.`);
    reportFailure({
      kind: "config",
      message: `${missingSecret} is not configured on the server.`,
      urgent: true,
    });
    return errorResponse(messages.unavailable, 503);
  }

  if (deps.verifyHuman && !deps.sessionSecret) {
    console.error("verifyHuman is set but sessionSecret is missing.");
    reportFailure({
      kind: "config",
      message: "A human check is configured without a session secret.",
      urgent: true,
    });
    return errorResponse(messages.unavailable, 503);
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse(messages.invalidBody, 400);
  }

  const chatRequest = parseChatRequest(payload, limits);

  if (!chatRequest) {
    return errorResponse(messages.invalidRequest, 400);
  }

  const identity = (deps.identify ?? defaultIdentify)(request);

  if (await deps.rateLimiter?.isLimited(identity.ip)) {
    return errorResponse(messages.rateLimited, 429);
  }

  const state = await deps.store.getConversationState(
    chatRequest.conversationId
  );

  if (state.messageCount >= limits.maxMessagesPerConversation) {
    return errorResponse(messages.conversationLimit, 429);
  }

  // First message: prove a human is present. After that, the signed session
  // token stands in so we don't re-challenge mid-conversation.
  let issuedSessionToken: string | null = null;

  if (deps.verifyHuman && deps.sessionSecret) {
    const secret = deps.sessionSecret;
    const presented = chatRequest.sessionToken;

    const sessionValid =
      presented !== undefined &&
      (await verifySessionToken(secret, presented, chatRequest.conversationId));

    if (!sessionValid) {
      if (!chatRequest.challengeToken) {
        return errorResponse(
          messages.challengeRequired,
          400,
          CHALLENGE_REQUIRED
        );
      }

      const verified = await deps.verifyHuman(
        chatRequest.challengeToken,
        identity.ip === "unknown" ? null : identity.ip
      );

      if (!verified) {
        return errorResponse(messages.challengeFailed, 403, CHALLENGE_FAILED);
      }

      issuedSessionToken = await issueSessionToken(
        secret,
        chatRequest.conversationId,
        { ttlMs: session.ttlMs }
      );
    } else if (
      presented &&
      shouldRefreshSessionToken(presented, {
        refreshBeforeMs: session.refreshBeforeMs,
      })
    ) {
      // Slide the window while the visitor is still talking, so a long
      // conversation is never interrupted by an expiry it did nothing to earn.
      issuedSessionToken = await issueSessionToken(
        secret,
        chatRequest.conversationId,
        { ttlMs: session.ttlMs }
      );
    }
  }

  await deps.store.ensureConversation(chatRequest.conversationId, {
    pagePath: chatRequest.pagePath,
    country: identity.country,
  });

  const history = await deps.store.loadHistory(
    chatRequest.conversationId,
    limits.historyTurnLimit
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const emit = (event: ChatEvent) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encodeEvent(event));
        } catch {
          closed = true;
        }
      };

      if (issuedSessionToken) {
        emit({ type: "session", sessionToken: issuedSessionToken });
      }

      try {
        const provider =
          typeof deps.provider === "function" ? deps.provider() : deps.provider;

        const result = await runChatTurn({
          provider,
          guardrails: deps.guardrails,
          knowledge: deps.knowledge,
          toolset: deps.toolset,
          toolContext: deps.toolContext,
          conversationId: chatRequest.conversationId,
          history,
          userMessage: chatRequest.message,
          messagesRemaining:
            limits.maxMessagesPerConversation - state.messageCount,
          emit,
          limits,
          messages,
        });

        emit({ type: "done" });

        // Persist after the stream is served so the visitor never waits on the
        // database.
        if (result.text) {
          runInBackground(
            deps.store
              .recordTurn(
                chatRequest.conversationId,
                chatRequest.message,
                result.text
              )
              .catch((error) => {
                console.error("Failed to persist chat turn:", error);
              })
          );
        }
      } catch (error) {
        console.error("Chat turn failed:", error);
        const failure = classifyFailure(error);
        reportFailure(failure);
        emit({ type: "error", error: visitorMessage(failure, messages) });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
