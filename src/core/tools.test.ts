import { describe, expect, it, vi } from "vitest";

import { createToolset, noTools, type ChatTool, type ToolContext } from "./tools.js";

function context(): ToolContext<{ tag: string }> {
  return {
    conversationId: "c1",
    history: [],
    currentUserMessage: "Hi",
    emit: () => {},
    context: { tag: "host-state" },
  };
}

const ok: ChatTool<{ tag: string }> = {
  definition: {
    name: "ok",
    description: "Always works.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  run: async (_input, ctx) => ({ content: ctx.context.tag, isError: false }),
};

const boom: ChatTool<{ tag: string }> = {
  definition: {
    name: "boom",
    description: "Always throws.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  run: async () => {
    throw new Error("database is on fire");
  },
};

describe("createToolset", () => {
  it("exposes the definitions in declaration order", () => {
    const toolset = createToolset([ok, boom]);

    expect(toolset.definitions.map((tool) => tool.name)).toEqual([
      "ok",
      "boom",
    ]);
  });

  it("hands the host's context through to the handler untouched", async () => {
    const toolset = createToolset([ok]);

    await expect(toolset.run("ok", {}, context())).resolves.toEqual({
      content: "host-state",
      isError: false,
    });
  });

  it("turns a thrown handler into an error the model can recover from", async () => {
    const onError = vi.fn();
    const toolset = createToolset([boom], { onError });

    const result = await toolset.run("boom", {}, context());

    expect(result.isError).toBe(true);
    // The model must never be handed the underlying cause — it will repeat it
    // to the visitor.
    expect(result.content).not.toContain("on fire");
    expect(onError).toHaveBeenCalledWith("boom", expect.any(Error));
  });

  it("lets the host phrase its own recovery guidance", async () => {
    const toolset = createToolset([boom], {
      errorGuidance: "Suggest emailing hello@example.com.",
      onError: () => {},
    });

    const result = await toolset.run("boom", {}, context());

    expect(result.content).toBe("Suggest emailing hello@example.com.");
  });

  it("reports an unknown tool rather than throwing", async () => {
    const toolset = createToolset([ok]);

    await expect(toolset.run("nope", {}, context())).resolves.toEqual({
      content: "Unknown tool: nope",
      isError: true,
    });
  });
});

describe("noTools", () => {
  it("is a valid, empty toolset", async () => {
    const toolset = noTools<{ tag: string }>();

    expect(toolset.definitions).toEqual([]);
    await expect(toolset.run("anything", {}, context())).resolves.toMatchObject(
      { isError: true }
    );
  });
});
