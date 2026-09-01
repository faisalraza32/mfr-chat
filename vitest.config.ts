import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The Anthropic and OpenAI SDKs refuse to construct under jsdom — they
    // guard against browser use. The core is server-side by definition.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
