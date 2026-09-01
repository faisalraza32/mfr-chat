import { createAnthropicProvider } from "./anthropic.js";
import {
  createOpenAiCompatibleProvider,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  OPENAI_DEFAULT_MODEL,
  XAI_BASE_URL,
  XAI_DEFAULT_MODEL,
} from "./openai.js";
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

export const PROVIDER_IDS: readonly ProviderId[] = [
  "anthropic",
  "openai",
  "xai",
  "deepseek",
];

export function isProviderId(value: unknown): value is ProviderId {
  return (
    typeof value === "string" &&
    PROVIDER_IDS.includes(value.trim().toLowerCase() as ProviderId)
  );
}

/**
 * The conventional env var holding the API key for each provider.
 *
 * The core never reads process.env or a Worker binding itself — the host does
 * that and hands over a `ProviderConfig`. These names are here so a host's
 * "which secret is missing?" message and its operator alerts can name the same
 * variable the docs do, without each host inventing its own spelling.
 */
export const PROVIDER_KEY_NAMES: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

/**
 * Display names, for operator alerts and for any published privacy policy that
 * has to name the processor handling visitor messages.
 */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  xai: "xAI",
  deepseek: "DeepSeek",
};

/** Where the provider processes requests, for a cross-border disclosure. */
export const PROVIDER_REGIONS: Record<ProviderId, string> = {
  anthropic: "the United States",
  openai: "the United States",
  xai: "the United States",
  // DeepSeek processes and stores requests in mainland China. Selecting it
  // makes a policy disclose a transfer outside North America, which some
  // clients' data-residency terms do not allow.
  deepseek: "China",
};

/**
 * Reads a configured provider name, falling back rather than failing open to
 * nothing when it is missing or unrecognised.
 */
export function resolveProviderId(
  configured: string | undefined | null,
  fallback: ProviderId
): ProviderId {
  const normalised = configured?.trim().toLowerCase();

  return isProviderId(normalised) ? (normalised as ProviderId) : fallback;
}

/**
 * Warns when the running provider isn't the one a published policy names.
 *
 * Sending visitor messages to an undisclosed processor is a privacy problem,
 * not a configuration detail, so this is loud rather than silent. Hosts that
 * publish no such policy can ignore it.
 */
export function assertProviderMatchesDeclared(
  active: ProviderId,
  declared: ProviderId,
  remedy = "Update the declared provider in your site configuration and redeploy"
): void {
  if (active !== declared) {
    console.error(
      `The active chat provider is "${active}" but the published policy declares ` +
        `"${declared}". ${remedy}, or the policy names the wrong data processor.`
    );
  }
}

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
