import type {
  ChatProvider,
  ProviderToolCall,
  ProviderTurn,
  StreamTurnRequest,
} from "./types.js";

/**
 * Adapter for Cloudflare Workers AI.
 *
 * Unlike every other provider here, this one is not an HTTP API with a key: it
 * is a runtime binding that only exists inside a Worker. The host passes the
 * binding in, which is why it has a constructor of its own rather than going
 * through `createProvider`.
 *
 * It is also the adapter with the most defensive code, and that is not
 * incidental. The open models on Workers AI are an order of magnitude cheaper
 * than the hosted APIs and correspondingly less disciplined about tool
 * calling, so the quirks below are the cost of the price. Each one was
 * confirmed against the live API; none is speculative.
 */

/** The `Ai` binding, structurally. Typing it this way keeps Cloudflare's types out of the core. */
export interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export const WORKERS_AI_DEFAULT_MODEL =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export interface WorkersAiOptions {
  ai: WorkersAiBinding;
  /** Overrides the default model. Any Workers AI model id that takes tools. */
  model?: string;
  /** Cap on the reply. Workers AI counts this towards neurons, not tokens. */
  maxTokens?: number;
  temperature?: number;
}

/** Either response shape Workers AI returns, depending on the model's vintage. */
interface WorkersAiResult {
  response?: unknown;
  tool_calls?: RawToolCall[];
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: RawToolCall[] };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface RawToolCall {
  id?: string;
  name?: string;
  arguments?: unknown;
  function?: { name?: string; arguments?: unknown };
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null) {
    return raw as Record<string, unknown>;
  }

  if (typeof raw !== "string" || !raw.trim()) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A malformed argument blob becomes an empty input; the tool handlers
    // validate anyway and ask the visitor again.
    return {};
  }
}

/**
 * Pulls the text and the tool calls out of whichever shape came back.
 *
 * Newer models answer in OpenAI's `choices` form, older ones in a flat
 * `response` plus `tool_calls`. Reading only one of them would silently drop
 * every call from the other.
 */
export function parseWorkersAiResult(
  result: WorkersAiResult | null | undefined
): { text: string; toolCalls: ProviderToolCall[] } {
  const message = result?.choices?.[0]?.message;
  const raw = message?.tool_calls ?? result?.tool_calls ?? [];

  const toolCalls: ProviderToolCall[] = raw
    .map((call, index) => {
      const fn = call.function ?? call;
      const name = String(fn.name ?? "");

      return {
        id: call.id ?? `call_${index}_${name}`,
        name,
        input: parseArguments(fn.arguments),
      };
    })
    .filter((call) => call.name);

  const content = message?.content ?? result?.response;
  const text =
    typeof content === "string"
      ? content
      : content
        ? JSON.stringify(content)
        : "";

  return { text, toolCalls };
}

/**
 * Recovers tool calls the model wrote out as text instead of making.
 *
 * `{"type":"function","function":{"name":"get_services",...}}` in the middle of
 * a reply is the model describing what it would like to do. Left alone the
 * visitor reads the JSON, so it is turned back into the call it was meant to
 * be — but only for tools the model was actually given, so a quoted example in
 * a visitor's own message cannot invent one.
 *
 * Returns the recovered calls and whatever prose was left around them.
 */
export function recoverTextToolCalls(
  text: string,
  toolNames: string[]
): { toolCalls: ProviderToolCall[]; rest: string } {
  const toolCalls: ProviderToolCall[] = [];
  let rest = "";
  let index = 0;

  while (index < text.length) {
    if (text[index] !== "{") {
      rest += text[index];
      index += 1;
      continue;
    }

    const end = findClosingBrace(text, index);
    const chunk = end === -1 ? "" : text.slice(index, end + 1);
    let parsed: unknown;

    try {
      parsed = chunk ? JSON.parse(chunk) : undefined;
    } catch {
      parsed = undefined;
    }

    const object = parsed as
      | { type?: string; name?: string; function?: RawToolCall; [key: string]: unknown }
      | undefined;
    const fn = (object?.function ?? object) as RawToolCall | undefined;
    const name = typeof fn?.name === "string" ? fn.name : "";

    if (object && name && toolNames.includes(name)) {
      toolCalls.push({
        id: `text_${toolCalls.length}_${name}`,
        name,
        input: parseArguments(
          fn?.arguments ?? (fn as { parameters?: unknown })?.parameters ?? {}
        ),
      });
      index = end + 1;
      continue;
    }

    rest += text[index];
    index += 1;
  }

  return { toolCalls, rest: rest.replace(/\s+/g, " ").trim() };
}

/** The index of the brace closing the one at `start`, honouring strings. */
function findClosingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;

  for (let i = start; i < text.length; i += 1) {
    const character = text[i];

    if (inString) {
      if (character === "\\") {
        i += 1;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Whether to offer the tool list on this call.
 *
 * Llama keeps asking for the same tool for ever if the list is sent again
 * after a result is already in the conversation, and answers correctly when it
 * is left out. The exception is a call that just failed: then it needs the
 * tools back to retry, or it writes the retry out as text.
 */
export function shouldOfferTools(messages: StreamTurnRequest["messages"]): boolean {
  const results = messages.flatMap((message) => message.toolResults ?? []);

  if (results.length === 0) {
    return true;
  }

  const last = results[results.length - 1];

  return Boolean(last?.isError) && results.length < 3;
}

export function createWorkersAiProvider(
  options: WorkersAiOptions
): ChatProvider {
  const model = options.model?.trim() || WORKERS_AI_DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? 512;
  const temperature = options.temperature ?? 0.3;

  return {
    id: "workers-ai",
    model,

    async streamTurn(request: StreamTurnRequest): Promise<ProviderTurn> {
      const offerTools = shouldOfferTools(request.messages);

      const result = (await options.ai.run(model, {
        // One system message rather than two: the open models follow a single
        // block more reliably than a pair, and there is no cache breakpoint
        // here to keep them apart for.
        messages: [
          { role: "system", content: systemBlock(request) },
          ...toWorkersAiMessages(request.messages),
        ],
        ...(offerTools && request.tools.length
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            }
          : {}),
        max_tokens: maxTokens,
        temperature,
      })) as WorkersAiResult;

      const parsed = parseWorkersAiResult(result);
      let { text, toolCalls } = parsed;

      if (toolCalls.length === 0 && text.includes("{")) {
        const recovered = recoverTextToolCalls(
          text,
          request.tools.map((tool) => tool.name)
        );

        if (recovered.toolCalls.length > 0) {
          text = recovered.rest;
          toolCalls = recovered.toolCalls;
        }
      }

      // Workers AI has no token stream through the binding, so the reply
      // arrives whole. Reported in one piece rather than faked in fragments.
      if (text) {
        request.onText(text);
      }

      return {
        text,
        toolCalls,
        usage: result?.usage
          ? {
              input: result.usage.prompt_tokens ?? 0,
              output: result.usage.completion_tokens ?? 0,
              // Workers AI bills neurons and reports no cache figures.
              cacheRead: 0,
              cacheWrite: 0,
            }
          : undefined,
      };
    },
  };
}

/**
 * Knowledge and guardrails as one block, skipping whichever is empty.
 *
 * A host that keeps its prompt in one piece passes it as `guardrails` and
 * leaves `knowledge` empty; joining unconditionally would prepend blank lines
 * to a prompt that was tuned without them.
 */
function systemBlock(request: StreamTurnRequest): string {
  return [request.knowledge, request.guardrails]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * An assistant turn that called tools is replayed as a line of text, not as a
 * structured call. The open models lose the thread when handed back their own
 * tool-call objects, and read the flattened form correctly.
 */
function toWorkersAiMessages(
  messages: StreamTurnRequest["messages"]
): Array<{ role: string; content: string; name?: string }> {
  const out: Array<{ role: string; content: string; name?: string }> = [];

  for (const message of messages) {
    if (message.toolResults?.length) {
      for (const result of message.toolResults) {
        out.push({ role: "tool", name: result.name, content: result.content });
      }
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: message.toolCalls
          .map((call) => `[tool call ${call.name} ${JSON.stringify(call.input)}]`)
          .join("\n"),
      });
      continue;
    }

    out.push({ role: message.role, content: message.content });
  }

  return out;
}
