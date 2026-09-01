/**
 * Provider-neutral chat types.
 *
 * The agent loop, tool execution, storage and streaming are all written
 * against these, so swapping providers touches only the adapters in this
 * directory. Each adapter maps these to its own wire format.
 */

export type ProviderId = "anthropic" | "openai" | "xai" | "deepseek";

export interface ProviderToolCall {
  id: string;
  name: string;
  /** Already parsed. Never string-match a serialised tool input. */
  input: Record<string, unknown>;
}

export interface ProviderToolResult {
  id: string;
  name: string;
  content: string;
  isError: boolean;
}

export interface ProviderMessage {
  role: "user" | "assistant";
  content: string;
  /** Present on an assistant turn that called tools. */
  toolCalls?: ProviderToolCall[];
  /** Results for the immediately preceding assistant turn's tool calls. */
  toolResults?: ProviderToolResult[];
}

export interface ProviderTool {
  name: string;
  description: string;
  /** Plain JSON Schema. Must set additionalProperties:false and list every key in required. */
  parameters: Record<string, unknown>;
}

export interface ProviderUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ProviderTurn {
  text: string;
  toolCalls: ProviderToolCall[];
  usage?: ProviderUsage;
}

export interface StreamTurnRequest {
  /** Stable instructions. Kept separate so adapters can cache the large part. */
  guardrails: string;
  /** The knowledge base — large, static, and the thing worth caching. */
  knowledge: string;
  messages: ProviderMessage[];
  tools: ProviderTool[];
  onText: (text: string) => void;
}

export interface ChatProvider {
  readonly id: ProviderId;
  readonly model: string;
  streamTurn(request: StreamTurnRequest): Promise<ProviderTurn>;
}

/** How each provider is built. Replaces reading a Cloudflare env object. */
export interface ProviderConfig {
  id: ProviderId;
  apiKey: string;
  /** Overrides the provider's default model. */
  model?: string;
  /**
   * Anthropic only: identity-linked keys must name the workspace the request
   * acts in. Workspace-scoped keys carry it already.
   */
  workspaceId?: string;
  /** Overrides the adapter's base URL. Rarely needed outside a proxy. */
  baseURL?: string;
}
