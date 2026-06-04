import type { ToolDefinition } from "@larb/providers";
import type { Tool } from "./types.js";
import { readFileTool, writeFileTool, listFilesTool, searchTextTool } from "./fs.js";
import { runCommandTool } from "./exec.js";
import { gitTool } from "./git.js";
import { httpFetchTool } from "./http.js";
import { delegateTool } from "./delegate.js";

/** Holds the available capability-tools and exposes them as provider tool defs. */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: Tool[]) {
    for (const t of tools) this.tools.set(t.name, t);
  }

  /** Register an additional tool (e.g. a loaded skill plugin tool). */
  add(tool: Tool): void {
    this.tools.set(tool.name, tool);
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

/** Full toolset for a worker agent (no delegation, to bound recursion). */
export function fullTools(): Tool[] {
  return [
    readFileTool,
    writeFileTool,
    listFilesTool,
    searchTextTool,
    runCommandTool,
    gitTool,
    httpFetchTool,
  ];
}

/** Orchestrator toolset: the full set plus the ability to delegate to workers. */
export function orchestratorTools(): Tool[] {
  return [...fullTools(), delegateTool];
}

export {
  readFileTool,
  writeFileTool,
  listFilesTool,
  searchTextTool,
  runCommandTool,
  gitTool,
  httpFetchTool,
  delegateTool,
};
