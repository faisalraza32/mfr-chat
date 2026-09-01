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
  messages?: Partial<Pick<ChatMessages, "toolLoopExhausted">>;
  /** Defaults to a `console.log`. Pass a no-op to silence it. */
  logUsage?: (usage: ProviderUsage & { provider: string; model: string }) => void;
}

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
  wrapUpAtRemaining: number
): string {
  if (messagesRemaining === undefined || messagesRemaining > wrapUpAtRemaining) {
    return userMessage;
  }

  return (
    `${userMessage}\n\n[System note, not from the visitor: this conversation ` +
    `is close to its length limit. Answer normally, then offer a clear next ` +
    `step so the conversation does not simply run out. Do not mention the ` +
    `limit or quote a number of messages.]`
  );
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
        wrapUpAtRemaining
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

  let assistantText = "";

  for (let iteration = 0; iteration < maxToolIterations; iteration += 1) {
    const turn = await provider.streamTurn({
      guardrails,
      knowledge,
      messages,
      tools: toolset.definitions,
      onText: (text) => {
        assistantText += text;
        emit({ type: "delta", text });
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
      return { text: assistantText };
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
    emit({ type: "delta", text: assistantText });
  }

  return { text: assistantText };
}
