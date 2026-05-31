import type { Tool, ToolContext, ToolResult } from "./types.js";

/**
 * Hand a well-scoped subtask to a cheaper worker agent. The orchestrator (strong
 * model) plans and delegates; workers (cheap/fast model) do focused execution.
 * The subagent shares the same permission engine and cost governor, so every
 * write/exec is still approved and global spend limits still apply.
 */
export const delegateTool: Tool = {
  name: "delegate",
  description:
    "Delegate a focused, self-contained subtask to a cheaper worker agent and " +
    "get back its result summary. Use for parallelizable investigation or " +
    "well-specified bulk edits. Give complete context — the worker does not see " +
    "this conversation.",
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "A complete, self-contained instruction for the worker agent",
      },
    },
    required: ["task"],
  },
  async execute(input, ctx): Promise<ToolResult> {
    if (!ctx.delegate) {
      return {
        ok: false,
        content: "Delegation is not available in this context.",
        summary: "delegate unavailable",
      };
    }
    const task = String(input.task ?? "").trim();
    if (!task) return { ok: false, content: "Error: empty subtask", summary: "delegate: empty" };
    const result = await ctx.delegate(task);
    return {
      ok: result.ok,
      content: `Worker agent result:\n${result.content}`,
      summary: `delegate → ${result.summary}`,
    };
  },
};
