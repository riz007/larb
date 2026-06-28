import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MAX_AGENT_INSTRUCTIONS_BYTES = 16 * 1024;

/**
 * Project-instruction files, in precedence order. `AGENTS.md` is the open,
 * tool-agnostic convention for telling a coding agent how to work in a repo
 * (build/test commands, conventions, do's and don'ts); `.larb/AGENTS.md` lets a
 * project keep Larb-specific guidance separate.
 */
const CANDIDATES = ["AGENTS.md", join(".larb", "AGENTS.md")];

/**
 * Read the project's agent-instruction files into a single, size-bounded block
 * for injection into the system prompt.
 *
 * This is project-authored guidance, surfaced only inside a run (i.e. after a
 * trust decision for the directory). It is advisory: it can shape how the agent
 * approaches the task, but it can NOT grant authority — every file write,
 * command, and network/MCP call is still gated by the permission engine
 * regardless of what these files say.
 */
export function loadAgentInstructions(projectRoot: string): string {
  const blocks: string[] = [];
  let budget = MAX_AGENT_INSTRUCTIONS_BYTES;
  for (const rel of CANDIDATES) {
    if (budget <= 0) break;
    const file = join(projectRoot, rel);
    if (!existsSync(file)) continue;
    let content: string;
    try {
      content = readFileSync(file, "utf8").trim();
    } catch {
      continue;
    }
    if (!content) continue;
    const block = `### ${rel}\n${content}`;
    const slice =
      block.length > budget ? `${block.slice(0, budget)}\n…(truncated)` : block;
    budget -= Math.min(block.length, budget);
    blocks.push(slice);
  }
  return blocks.join("\n\n");
}
