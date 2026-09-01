import { createAnthropicProvider } from "./anthropic.js";
import {
  createOpenAiCompatibleProvider,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  OPENAI_DEFAULT_MODEL,
  XAI_BASE_URL,
  XAI_DEFAULT_MODEL,
} from "./openai.js";
import { PROVIDER_KEY_NAMES } from "./metadata.js";
import type { ChatProvider, ProviderConfig, ProviderId } from "./types.js";

export * from "./types.js";
export { createAnthropicProvider, ANTHROPIC_DEFAULT_MODEL } from "./anthropic.js";
export {
  createOpenAiCompatibleProvider,
  OPENAI_DEFAULT_MODEL,
  XAI_BASE_URL,
  XAI_DEFAULT_MODEL,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
} from "./openai.js";

export * from "./metadata.js";

/**
 * Wire settings for the providers that speak the OpenAI protocol. OpenAI
 * itself needs no base URL; the others are the same adapter pointed elsewhere.
 */
const OPENAI_COMPATIBLE: Partial<
  Record<
    ProviderId,
    { baseURL?: string; defaultModel: string; strictTools?: boolean }
  >
> = {
  openai: { defaultModel: OPENAI_DEFAULT_MODEL },
  xai: { baseURL: XAI_BASE_URL, defaultModel: XAI_DEFAULT_MODEL },
  deepseek: {
    baseURL: DEEPSEEK_BASE_URL,
    defaultModel: DEEPSEEK_DEFAULT_MODEL,
    strictTools: false,
  },
};

export function createProvider(config: ProviderConfig): ChatProvider {
  if (!config.apiKey?.trim()) {
    throw new Error(`${PROVIDER_KEY_NAMES[config.id]} is not configured.`);
  }

  if (config.id === "anthropic") {
    return createAnthropicProvider(config);
  }

  const wire = OPENAI_COMPATIBLE[config.id];

  if (!wire) {
    throw new Error(`No adapter for chat provider "${config.id}".`);
  }

  return createOpenAiCompatibleProvider({
    id: config.id,
    apiKey: config.apiKey,
    model: config.model,
    ...wire,
    // An explicit override wins over the built-in base URL.
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
}
