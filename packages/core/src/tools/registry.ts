import type { ToolDefinition } from "@larb/providers";
import type { Tool } from "./types.js";
import { readFileTool, writeFileTool, listFilesTool, searchTextTool } from "./fs.js";
import { runCommandTool } from "./exec.js";

/** Holds the available capability-tools and exposes them as provider tool defs. */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: Tool[]) {
    for (const t of tools) this.tools.set(t.name, t);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }
}

/** Read-only toolset for `ask` mode. */
export function readOnlyTools(): Tool[] {
  return [readFileTool, listFilesTool, searchTextTool];
}

/** Full toolset for autonomous `run` mode. */
export function fullTools(): Tool[] {
  return [readFileTool, writeFileTool, listFilesTool, searchTextTool, runCommandTool];
}

export { readFileTool, writeFileTool, listFilesTool, searchTextTool, runCommandTool };
