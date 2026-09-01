/**
 * Provider facts that carry no SDK with them.
 *
 * This is its own module, and its own entry point, because a browser bundle
 * needs some of it: a privacy policy has to name the processor handling
 * visitor messages, and importing that from the barrel would drag both model
 * SDKs into the page. Tree-shaking might save you. It might also not, and the
 * failure is silent and large.
 */
import type { ProviderId } from "./types.js";

export type { ProviderId };

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
