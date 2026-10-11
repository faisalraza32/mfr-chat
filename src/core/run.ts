import {
  DEFAULT_LIMITS,
  DEFAULT_MESSAGES,
  type ChatLimits,
  type ChatMessages,
} from "./config.js";
import type {
  ChatProvider,
  ProviderMessage,
  ProviderUsage,
} from "./providers/types.js";
import type { ChatToolset, ToolContext } from "./tools.js";
import type { ChatEvent, StoredMessage } from "./types.js";

export interface RunResult {
  text: string;
}

export interface RunChatTurnOptions<Ctx> {
  /**
   * An already-built provider. Constructing it is the host's job — that is
   * where the API key lives — and doing it before the call means a missing key
   * fails somewhere the host can classify it.
   */
  provider: ChatProvider;
  /** Stable instructions. Sits ahead of the knowledge base in the prompt. */
  guardrails: string;
  /** The large, static block worth caching. */
  knowledge: string;
  toolset: ChatToolset<Ctx>;
  /** Passed through untouched to every tool handler. */
  toolContext: Ctx;
  conversationId: string;
  history: StoredMessage[];
  userMessage: string;
  /** Messages left in this conversation before the cap. */
  messagesRemaining?: number;
  emit: (event: ChatEvent) => void;
  limits?: Partial<Pick<ChatLimits, "maxToolIterations" | "wrapUpAtRemaining">>;
  /**
   * The steer appended to the visitor's message near the cap. Prompt content,
   * so it belongs to the host: the default cannot name a next step, because it
   * does not know which tools you gave the assistant.
   */
  wrapUpNote?: string;
  messages?: Partial<Pick<ChatMessages, "toolLoopExhausted">>;
  /**
   * The last look at a finished reply before anybody sees it. Return null to
   * send it as the model wrote it, or the text to send instead.
   *
   * Supplying this holds the reply back until the turn is complete: the
   * visitor gets it in one piece rather than token by token. That is the
   * price of never showing something that has to be taken back — a reply
   * reciting its own instructions has leaked them whether or not it is pulled
   * a second later. Leave it out and the stream behaves exactly as before.
   *
   * Tool events are not held back, only text: a booking button the visitor can
   * already see is not something the reply can retract.
   *
   * May be async. A host whose replacement is computed rather than canned —
   * one that answers again from its own data, running tools to do it — needs
   * to await something, and the alternative is that it cannot use this hook
   * at all. The visitor is already waiting for the turn to finish, so the
   * cost is whatever the replacement itself costs.
   */
  validateReply?: (text: string) => string | null | Promise<string | null>;
  /** Defaults to a `console.log`. Pass a no-op to silence it. */
  logUsage?: (usage: ProviderUsage & { provider: string; model: string }) => void;
}

export const DEFAULT_WRAP_UP_NOTE =
  "this conversation is close to its length limit. Answer normally, then " +
  "offer a clear next step so the conversation does not simply run out. Do " +
  "not mention the limit or quote a number of messages.";

/**
 * Appends a private steer when the conversation is near its cap.
 *
 * Sent to the model but never persisted — the caller stores the visitor's own
 * message, so the transcript stays clean. It goes here rather than into the
 * guardrails because the guardrails sit in the cached prompt prefix, and
 * varying them per request would throw the cache away.
 */
function withWrapUpNote(
  userMessage: string,
  messagesRemaining: number | undefined,
  wrapUpAtRemaining: number,
  note: string
): string {
  if (messagesRemaining === undefined || messagesRemaining > wrapUpAtRemaining) {
    return userMessage;
  }

  return `${userMessage}\n\n[System note, not from the visitor: ${note}]`;
}

function defaultLogUsage(
  usage: ProviderUsage & { provider: string; model: string }
): void {
  console.log("chat usage", usage);
}

export async function runChatTurn<Ctx>(
  options: RunChatTurnOptions<Ctx>
): Promise<RunResult> {
  const {
    provider,
    guardrails,
    knowledge,
    toolset,
    toolContext,
    conversationId,
    history,
    userMessage,
    emit,
  } = options;

  const maxToolIterations =
    options.limits?.maxToolIterations ?? DEFAULT_LIMITS.maxToolIterations;
  const wrapUpAtRemaining =
    options.limits?.wrapUpAtRemaining ?? DEFAULT_LIMITS.wrapUpAtRemaining;
  const toolLoopExhausted =
    options.messages?.toolLoopExhausted ?? DEFAULT_MESSAGES.toolLoopExhausted;
  const wrapUpNote = options.wrapUpNote ?? DEFAULT_WRAP_UP_NOTE;
  const logUsage = options.logUsage ?? defaultLogUsage;

  const messages: ProviderMessage[] = [
    ...history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: "user" as const,
      content: withWrapUpNote(
        userMessage,
        options.messagesRemaining,
        wrapUpAtRemaining,
        wrapUpNote
      ),
    },
  ];

  const context: ToolContext<Ctx> = {
    conversationId,
    history,
    currentUserMessage: userMessage,
    emit,
    context: toolContext,
  };

  const validateReply = options.validateReply;
  /** With a validator, nothing goes out until there is something to validate. */
  const buffering = Boolean(validateReply);

  /**
   * The single exit: checks the reply where a validator was given, sends
   * whatever survives, and reports that same text back so the host stores what
   * the visitor actually saw rather than what the model first wrote.
   */
  const finish = async (text: string): Promise<RunResult> => {
    if (!validateReply) {
      return { text };
    }

    const finalText = (await validateReply(text)) ?? text;

    if (finalText) {
      emit({ type: "delta", text: finalText });
    }

    return { text: finalText };
  };

  let assistantText = "";

  for (let iteration = 0; iteration < maxToolIterations; iteration += 1) {
    const turn = await provider.streamTurn({
      guardrails,
      knowledge,
      messages,
      tools: toolset.definitions,
      onText: (text) => {
        assistantText += text;

        if (!buffering) {
          emit({ type: "delta", text });
        }
      },
    });

    if (turn.usage) {
      logUsage({
        ...turn.usage,
        provider: provider.id,
        model: provider.model,
      });
    }

    if (turn.toolCalls.length === 0) {
      return finish(assistantText);
    }

    messages.push({
      role: "assistant",
      content: turn.text,
      toolCalls: turn.toolCalls,
    });

    const toolResults = [];

    for (const call of turn.toolCalls) {
      const result = await toolset.run(call.name, call.input, context);

      toolResults.push({
        id: call.id,
        name: call.name,
        content: result.content,
        isError: result.isError,
      });
    }

    messages.push({ role: "user", content: "", toolResults });
  }

  // Ran out of iterations without settling. Say something useful rather than
  // leaving the bubble empty.
  if (!assistantText) {
    assistantText = toolLoopExhausted;

    if (!buffering) {
      emit({ type: "delta", text: assistantText });
    }
  }

  return finish(assistantText);
}
