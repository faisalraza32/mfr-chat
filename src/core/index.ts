/**
 * @mfr/chat/core — the runtime-agnostic half of the chat assistant.
 *
 * What is here: provider adapters, the agent loop, session tokens, request
 * validation, SSE encoding, failure classification, and a handler that turns a
 * `Request` into a streaming `Response`.
 *
 * What is deliberately not here: any database, any bot check, any email, any
 * prompt, any tool. Those arrive through the ports in ./ports.ts and the
 * toolset in ./tools.ts, because they are the parts that differ between a
 * public marketing site and an authenticated application.
 */
export * from "./types.js";
export * from "./ports.js";
export * from "./config.js";
export * from "./failures.js";
export * from "./providers/index.js";
export * from "./session.js";
export * from "./sse.js";
export * from "./tools.js";
export * from "./validate.js";
export { runChatTurn, DEFAULT_WRAP_UP_NOTE } from "./run.js";
export type { RunResult, RunChatTurnOptions } from "./run.js";
export { handleChatRequest } from "./handler.js";
export type { ChatHandlerDeps } from "./handler.js";
