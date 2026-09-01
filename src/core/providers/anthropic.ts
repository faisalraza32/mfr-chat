import Anthropic from "@anthropic-ai/sdk";

import type {
  ChatProvider,
  ProviderConfig,
  ProviderToolCall,
  ProviderTurn,
  StreamTurnRequest,
} from "./types.js";

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5";

export function createAnthropicProvider(config: ProviderConfig): ChatProvider {
  const workspaceId = config.workspaceId?.trim();

  const client = new Anthropic({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    // Identity-linked keys must name the workspace the request acts in;
    // workspace-scoped keys carry it already.
    ...(workspaceId
      ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } }
      : {}),
  });

  const model = config.model?.trim() || ANTHROPIC_DEFAULT_MODEL;

  return {
    id: "anthropic",
    model,

    async streamTurn(request: StreamTurnRequest): Promise<ProviderTurn> {
      const stream = client.messages.stream({
        model,
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        // Short factual answers off a fixed knowledge base — not a
        // reasoning-heavy workload, and low effort keeps latency down.
        output_config: { effort: "low" },
        system: [
          { type: "text", text: request.guardrails },
          {
            type: "text",
            text: request.knowledge,
            // The breakpoint goes after the knowledge base so the entire
            // volatile part of the request sits behind it.
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ],
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          strict: true,
          input_schema: tool.parameters as Anthropic.Tool["input_schema"],
        })),
        messages: toAnthropicMessages(request.messages),
      });

      stream.on("text", (text) => request.onText(text));

      const response = await stream.finalMessage();

      const toolCalls: ProviderToolCall[] = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
        .map((block) => ({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        }));

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      return {
        text,
        toolCalls,
        usage: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          cacheRead: response.usage.cache_read_input_tokens ?? 0,
          cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
        },
      };
    },
  };
}

function toAnthropicMessages(
  messages: StreamTurnRequest["messages"]
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const message of messages) {
    if (message.toolResults?.length) {
      // All results for one assistant turn must arrive in a single user
      // message, or the model learns to stop calling tools in parallel.
      out.push({
        role: "user",
        content: message.toolResults.map((result) => ({
          type: "tool_result" as const,
          tool_use_id: result.id,
          content: result.content,
          is_error: result.isError,
        })),
      });
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      const blocks: Anthropic.ContentBlockParam[] = [];

      if (message.content) {
        blocks.push({ type: "text", text: message.content });
      }

      for (const call of message.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.input,
        });
      }

      out.push({ role: "assistant", content: blocks });
      continue;
    }

    out.push({ role: message.role, content: message.content });
  }

  return out;
}
