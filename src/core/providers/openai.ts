import OpenAI from "openai";

import type {
  ChatProvider,
  ProviderId,
  ProviderToolCall,
  ProviderTurn,
  StreamTurnRequest,
} from "./types.js";

export const OPENAI_DEFAULT_MODEL = "gpt-5";
export const XAI_DEFAULT_MODEL = "grok-4";
export const XAI_BASE_URL = "https://api.x.ai/v1";
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-chat";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

export interface OpenAiCompatibleOptions {
  id: ProviderId;
  apiKey: string;
  baseURL?: string;
  defaultModel: string;
  model?: string;
  /**
   * Whether the API honours strict function schemas. OpenAI and xAI do;
   * DeepSeek does not, and rejects or ignores the flag, so its tool calls are
   * validated by the handlers instead.
   */
  strictTools?: boolean;
}

/**
 * Adapter for OpenAI and any OpenAI-compatible API. xAI's Grok and DeepSeek
 * speak the same protocol, so they are the same code with a different base
 * URL, model, and — for DeepSeek — no strict tool schemas.
 *
 * Caching note: unlike Anthropic, there is no explicit cache breakpoint here.
 * These APIs cache automatically on a matching prefix, which is why the
 * knowledge base goes first in the system message and every volatile part of
 * the request comes after it — the prefix stays byte-identical between turns.
 */
export function createOpenAiCompatibleProvider(
  options: OpenAiCompatibleOptions
): ChatProvider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });

  const model = options.model?.trim() || options.defaultModel;
  const strictTools = options.strictTools ?? true;

  return {
    id: options.id,
    model,

    async streamTurn(request: StreamTurnRequest): Promise<ProviderTurn> {
      const stream = await client.chat.completions.create({
        model,
        max_completion_tokens: 2048,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          // Knowledge first: it is the large static prefix worth caching.
          { role: "system", content: request.knowledge },
          { role: "system", content: request.guardrails },
          ...toOpenAiMessages(request.messages),
        ],
        tools: request.tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description,
            ...(strictTools ? { strict: true } : {}),
            parameters: tool.parameters,
          },
        })),
      });

      let text = "";
      const calls = new Map<
        number,
        { id: string; name: string; args: string }
      >();
      let usage: ProviderTurn["usage"];

      for await (const chunk of stream) {
        if (chunk.usage) {
          usage = {
            input: chunk.usage.prompt_tokens ?? 0,
            output: chunk.usage.completion_tokens ?? 0,
            cacheRead: readCacheHits(chunk.usage),
            // These APIs populate the cache implicitly, so there is no
            // separate write figure to report.
            cacheWrite: 0,
          };
        }

        const delta = chunk.choices?.[0]?.delta;

        if (!delta) {
          continue;
        }

        if (delta.content) {
          text += delta.content;
          request.onText(delta.content);
        }

        // Tool calls stream in fragments keyed by index; arguments arrive as
        // partial JSON that is only parseable once the stream ends.
        for (const call of delta.tool_calls ?? []) {
          const existing = calls.get(call.index) ?? {
            id: call.id ?? "",
            name: "",
            args: "",
          };

          calls.set(call.index, {
            id: call.id ?? existing.id,
            name: call.function?.name ?? existing.name,
            args: existing.args + (call.function?.arguments ?? ""),
          });
        }
      }

      const toolCalls: ProviderToolCall[] = [];

      for (const call of calls.values()) {
        if (!call.name) {
          continue;
        }

        toolCalls.push({
          id: call.id || call.name,
          name: call.name,
          input: parseArguments(call.args),
        });
      }

      return { text, toolCalls, usage };
    },
  };
}

/**
 * Cache hits are reported under different names: OpenAI and xAI nest them in
 * prompt_tokens_details, DeepSeek reports a flat prompt_cache_hit_tokens.
 * Reading only the first would log every DeepSeek turn as a cache miss.
 */
function readCacheHits(usage: OpenAI.Completions.CompletionUsage): number {
  const nested = usage.prompt_tokens_details?.cached_tokens;

  if (typeof nested === "number") {
    return nested;
  }

  const flat = (usage as unknown as Record<string, unknown>)
    .prompt_cache_hit_tokens;

  return typeof flat === "number" ? flat : 0;
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    // A truncated or malformed argument blob becomes an empty input; the tool
    // handlers already validate and ask the visitor again.
    return {};
  }
}

function toOpenAiMessages(
  messages: StreamTurnRequest["messages"]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  for (const message of messages) {
    if (message.toolResults?.length) {
      // Each result is its own message here, unlike Anthropic's single
      // user turn carrying every result.
      for (const result of message.toolResults) {
        out.push({
          role: "tool",
          tool_call_id: result.id,
          content: result.content,
        });
      }
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.input),
          },
        })),
      });
      continue;
    }

    out.push({ role: message.role, content: message.content });
  }

  return out;
}
