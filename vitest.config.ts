import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Two environments, because the halves of this package genuinely differ.
    // The Anthropic and OpenAI SDKs refuse to construct under jsdom — they
    // guard against browser use — so the core runs on node, where a DOM setup
    // file could not even be imported.
    projects: [
      {
        test: {
          name: "core",
          environment: "node",
          include: ["src/core/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "react",
          environment: "jsdom",
          include: ["src/react/**/*.test.{ts,tsx}"],
          setupFiles: ["src/react/setup-tests.ts"],
        },
      },
    ],
  },
});
