import { resolve } from "node:path";
import type { Tool, ToolContext, ToolResult } from "./types.js";

const MAX_OUTPUT = 16 * 1024;

/**
 * First-class git capability. Distinct from `run_command` so a user can grant
 * version-control access without granting arbitrary command execution. Runs in
 * the sandbox (host secrets stripped), so network operations like `push` will
 * not silently use ambient credentials.
 */
export const gitTool: Tool = {
  name: "git",
  description:
    "Run a git subcommand in the project (e.g. \"status --short\", \"diff\", " +
    '"add -A", "commit -m \\"msg\\"", "log --oneline -5", "branch"). Requires ' +
    "git approval. Prefer this over run_command for version control.",
  inputSchema: {
    type: "object",
    properties: {
      args: {
        type: "string",
        description: 'Arguments after `git`, e.g. "commit -m \\"fix typo\\""',
      },
    },
    required: ["args"],
  },
  async execute(input, ctx): Promise<ToolResult> {
    const args = String(input.args ?? "").trim();
    if (!args) return { ok: false, content: "Error: no git args provided", summary: "git: no args" };
    const command = `git ${args}`;

    await ctx.permission.require({
      capability: "git",
      path: resolve(ctx.projectRoot),
      command,
      reason: command,
    });

    const res = await ctx.sandbox.run(command);
    const out = [
      `$ ${command}`,
      res.stdout.trim(),
      res.stderr.trim() ? `[stderr]\n${res.stderr.trim()}` : "",
      res.timedOut ? "[timed out]" : `[exit ${res.code}]`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      ok: res.code === 0 && !res.timedOut,
      content: out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + "\n…[truncated]" : out,
      summary: `git ${args} → exit ${res.timedOut ? "timeout" : res.code}`,
    };
  },
};
