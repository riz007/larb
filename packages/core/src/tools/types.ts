import type { AuditLog, PermissionEngine } from "@larb/governors";
import type { Sandbox } from "@larb/sandbox";
import type { ProjectMemory } from "@larb/context";

/** Result a tool returns to the agent loop. `content` is fed back to the model. */
export interface ToolResult {
  ok: boolean;
  content: string;
  /** Short human-readable summary for the audit log / UI. */
  summary: string;
}

/** Shared services every tool may use, injected by the orchestrator. */
export interface ToolContext {
  projectRoot: string;
  permission: PermissionEngine;
  sandbox: Sandbox;
  audit: AuditLog;
  memory: ProjectMemory;
  /** UI hook: render a proposed file diff before write approval. */
  onDiff?: (path: string, diff: string) => void;
  /** UI hook: surface streamed informational notes. */
  onNote?: (note: string) => void;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
