import { describe, expect, it, vi } from "vitest";

import {
  assertProviderMatchesDeclared,
  createProvider,
  isProviderId,
  PROVIDER_IDS,
  PROVIDER_KEY_NAMES,
  PROVIDER_LABELS,
  PROVIDER_REGIONS,
  resolveProviderId,
} from "./index.js";

describe("resolveProviderId", () => {
  it("falls back rather than failing open to nothing", () => {
    expect(resolveProviderId(undefined, "openai")).toBe("openai");
    expect(resolveProviderId(null, "anthropic")).toBe("anthropic");
    expect(resolveProviderId("", "openai")).toBe("openai");
  });

  it("reads a configured provider, case- and whitespace-insensitively", () => {
    expect(resolveProviderId("anthropic", "openai")).toBe("anthropic");
    expect(resolveProviderId(" XAI ", "openai")).toBe("xai");
  });

  it("ignores an unknown provider", () => {
    expect(resolveProviderId("gemini", "openai")).toBe("openai");
  });
});

describe("isProviderId", () => {
  it("accepts every id it ships an adapter for, and nothing else", () => {
    for (const id of PROVIDER_IDS) {
      expect(isProviderId(id)).toBe(true);
    }

    expect(isProviderId("gemini")).toBe(false);
    expect(isProviderId(42)).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
  });
});

describe("createProvider", () => {
  it("builds each provider with its own default model", () => {
    expect(createProvider({ id: "anthropic", apiKey: "k" })).toMatchObject({
      id: "anthropic",
      model: "claude-opus-5",
    });
    expect(createProvider({ id: "openai", apiKey: "k" })).toMatchObject({
      id: "openai",
      model: "gpt-5",
    });
    expect(createProvider({ id: "xai", apiKey: "k" })).toMatchObject({
      id: "xai",
      model: "grok-4",
    });
    expect(createProvider({ id: "deepseek", apiKey: "k" })).toMatchObject({
      id: "deepseek",
      model: "deepseek-chat",
    });
  });

  it("lets a model override any provider's default", () => {
    expect(
      createProvider({ id: "openai", apiKey: "k", model: "gpt-5-mini" })
    ).toMatchObject({ model: "gpt-5-mini" });
  });

  it("names the missing key for the requested provider", () => {
    expect(() => createProvider({ id: "openai", apiKey: "" })).toThrow(
      "OPENAI_API_KEY"
    );
    expect(() => createProvider({ id: "anthropic", apiKey: "   " })).toThrow(
      "ANTHROPIC_API_KEY"
    );
  });
});

describe("assertProviderMatchesDeclared", () => {
  it("warns loudly when the running provider is not the one a policy names", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    assertProviderMatchesDeclared("deepseek", "openai");

    // Sending visitor messages to an undisclosed processor is a privacy
    // problem, so this must never be silent.
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("published policy declares")
    );
    spy.mockRestore();
  });

  it("stays quiet when provider and policy agree", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    assertProviderMatchesDeclared("openai", "openai");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("provider metadata", () => {
  it("labels every provider, for alerts and any published policy", () => {
    expect(PROVIDER_LABELS).toEqual({
      anthropic: "Anthropic",
      openai: "OpenAI",
      xai: "xAI",
      deepseek: "DeepSeek",
    });
  });

  it("names a key and a region for every provider", () => {
    for (const id of PROVIDER_IDS) {
      expect(PROVIDER_KEY_NAMES[id]).toBeTruthy();
      expect(PROVIDER_REGIONS[id]).toBeTruthy();
    }

    // Not the United States, unlike every other provider — a policy has to say
    // so, so this is pinned rather than left to drift.
    expect(PROVIDER_REGIONS.deepseek).toBe("China");
  });
});
