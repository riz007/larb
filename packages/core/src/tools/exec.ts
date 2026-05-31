import { resolve } from "node:path";
import type { Tool, ToolContext, ToolResult } from "./types.js";

const MAX_OUTPUT_IN_RESULT = 16 * 1024;

export const runCommandTool: Tool = {
  name: "run_command",
  description:
    "Run a shell command inside the project sandbox (cwd-scoped, host secrets " +
    "stripped). Requires exec approval. Use for builds, tests, git, etc.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command line" },
      reason: { type: "string", description: "Why this command is needed" },
    },
    required: ["command"],
  },
  async execute(input, ctx): Promise<ToolResult> {
    const command = String(input.command ?? "");
    const reason = String(input.reason ?? command);
    await ctx.permission.require({
      capability: "exec",
      path: resolve(ctx.projectRoot),
      command,
      reason: `run: ${command}${reason !== command ? ` — ${reason}` : ""}`,
    });

    const result = await ctx.sandbox.run(command);
    const out = [
      `$ ${command}`,
      result.stdout.trim(),
      result.stderr.trim() ? `[stderr]\n${result.stderr.trim()}` : "",
      result.timedOut ? "[timed out]" : `[exit ${result.code}]`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      ok: result.code === 0 && !result.timedOut,
      content: out.length > MAX_OUTPUT_IN_RESULT ? out.slice(0, MAX_OUTPUT_IN_RESULT) + "\n…[truncated]" : out,
      summary: `run \`${command}\` → exit ${result.timedOut ? "timeout" : result.code}`,
    };
  },
};
