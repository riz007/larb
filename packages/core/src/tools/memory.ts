import type { Tool, ToolContext, ToolResult } from "./types.js";

const MAX_MEMORY_BYTES = 8 * 1024;

/**
 * Cross-session project memory. Notes are plain markdown files under
 * <project>/.larb/memory — inspectable and editable by the user — and are
 * injected into the system context of every future session. This is what lets
 * a long-running agent LEARN a project (conventions, gotchas, decisions)
 * instead of rediscovering it every run.
 *
 * Writes are gated by fs.write like any other file mutation.
 */
export const rememberTool: Tool = {
  name: "remember",
  description:
    "Save a durable project note to memory (markdown, survives across sessions " +
    "and is loaded into context next time). Use for non-obvious facts worth " +
    "keeping: build/test quirks, architectural decisions, conventions, gotchas. " +
    "Do NOT save things already obvious from the code. Overwrites any existing " +
    "note with the same name.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Short kebab-case identifier, e.g. 'build-quirks'",
      },
      content: {
        type: "string",
        description: "The note body (markdown). Keep it brief and factual.",
      },
    },
    required: ["name", "content"],
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const name = String(input.name ?? "").trim();
    const content = String(input.content ?? "").trim();
    if (!name) return fail("name must not be empty.");
    if (!content) return fail("content must not be empty.");
    if (content.length > MAX_MEMORY_BYTES) {
      return fail(`Note too large (${content.length} bytes > ${MAX_MEMORY_BYTES}). Keep memory brief.`);
    }

    const path = ctx.memory.pathFor(name);
    await ctx.permission.require({
      capability: "fs.write",
      path,
      reason: `remember "${name}" (${content.length} bytes to .larb/memory)`,
    });

    ctx.memory.remember(name, content);
    return {
      ok: true,
      content: `Saved memory "${name}" (${content.length} bytes). It will be loaded into context in future sessions.`,
      summary: `remembered "${name}"`,
    };
  },
};

function fail(message: string): ToolResult {
  return { ok: false, content: `Error: ${message}`, summary: message };
}
