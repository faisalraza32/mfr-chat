/**
 * The tool registry.
 *
 * The agent loop is generic; the tools never are. The original pair — show a
 * booking button, send a message to the team — are pure marketing-site
 * concerns, so they stay in the host. What lives here is the shape a tool has
 * to be, and the guarantee the loop depends on: running one never throws.
 */
import type { ProviderTool } from "./providers/types.js";
import type { ChatEvent, StoredMessage } from "./types.js";

export interface ToolResult {
  content: string;
  isError: boolean;
}

/**
 * What a tool handler is given. `context` is whatever the host needs to do its
 * work — a database handle, an env object, a signed-in user — passed straight
 * through by the core, which never looks inside it.
 */
export interface ToolContext<Ctx> {
  conversationId: string;
  history: StoredMessage[];
  currentUserMessage: string;
  emit: (event: ChatEvent) => void;
  context: Ctx;
}

export interface ChatTool<Ctx> {
  /**
   * Plain JSON Schema so every provider adapter can render it into its own
   * format. Set `additionalProperties: false` and list every key in
   * `required`, or strict mode is rejected.
   */
  definition: ProviderTool;
  run(
    input: Record<string, unknown>,
    context: ToolContext<Ctx>
  ): Promise<ToolResult>;
}

export interface ChatToolset<Ctx> {
  definitions: ProviderTool[];
  /**
   * Runs one tool call and returns the text handed back to the model. Never
   * throws — a failed tool becomes an error string the model can recover from
   * and explain, rather than a dead conversation.
   */
  run(
    name: string,
    input: Record<string, unknown>,
    context: ToolContext<Ctx>
  ): Promise<ToolResult>;
}

export interface ToolsetOptions {
  /**
   * What the model is told when a handler throws. Phrase it as an instruction
   * to the assistant, not as text for the visitor — the model decides how to
   * pass it on.
   */
  errorGuidance?: string;
  /** Defaults to `console.error`. */
  onError?: (name: string, error: unknown) => void;
}

const DEFAULT_ERROR_GUIDANCE =
  "That didn't go through because of a technical problem. Apologise briefly and suggest getting in touch another way.";

export function createToolset<Ctx>(
  tools: ChatTool<Ctx>[],
  options: ToolsetOptions = {}
): ChatToolset<Ctx> {
  const byName = new Map(tools.map((tool) => [tool.definition.name, tool]));
  const errorGuidance = options.errorGuidance ?? DEFAULT_ERROR_GUIDANCE;
  const onError =
    options.onError ??
    ((name: string, error: unknown) => {
      console.error(`Chat tool "${name}" failed:`, error);
    });

  return {
    definitions: tools.map((tool) => tool.definition),

    async run(name, input, context) {
      const tool = byName.get(name);

      if (!tool) {
        return { content: `Unknown tool: ${name}`, isError: true };
      }

      try {
        return await tool.run(input, context);
      } catch (error) {
        onError(name, error);
        return { content: errorGuidance, isError: true };
      }
    },
  };
}

/** An empty toolset, for a host that wants answers and nothing else. */
export function noTools<Ctx>(): ChatToolset<Ctx> {
  return createToolset<Ctx>([]);
}
