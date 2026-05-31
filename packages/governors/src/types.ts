/**
 * Shared types for the cross-cutting governors.
 *
 * Capabilities are the unit of authority in Larb. Every tool call, skill, and
 * command execution must declare the capabilities it needs; the permission
 * engine enforces exactly that — nothing more.
 */

export type Capability =
  | "fs.read"
  | "fs.write"
  | "exec"
  | "net"
  | "git"
  | "secret";

export const ALL_CAPABILITIES: readonly Capability[] = [
  "fs.read",
  "fs.write",
  "exec",
  "net",
  "git",
  "secret",
];

/**
 * A concrete request to use a capability against a specific resource.
 * `path` scopes filesystem caps, `host` scopes network, `command` scopes exec.
 */
export interface PermissionRequest {
  capability: Capability;
  /** Absolute path the capability targets (fs.*). */
  path?: string;
  /** Network host the capability targets (net). */
  host?: string;
  /** Command line the capability targets (exec/git). */
  command?: string;
  /** Human-readable reason shown in the approval prompt. */
  reason: string;
}

export type Decision = "allow-once" | "allow-session" | "always" | "deny";

/**
 * A persisted/active grant. A grant matches a request when the capability is
 * equal and the request's scope is contained by the grant's scope.
 */
export interface Grant {
  capability: Capability;
  /** Path prefix this grant covers (fs.*). Absent ⇒ any path. */
  pathPrefix?: string;
  /** Host this grant covers (net). Absent ⇒ any host. */
  host?: string;
  /** Persisted across sessions when true ("always"). */
  persistent: boolean;
}

/**
 * The approver is how the permission engine asks a human (CLI/TUI) to decide.
 * Implemented by the interface layer.
 */
export type Approver = (request: PermissionRequest) => Promise<Decision>;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface SpendLimits {
  /** USD ceiling for a single `run` invocation. */
  perRun: number;
  /** USD ceiling for the current process session. */
  perSession: number;
  /** USD ceiling per calendar day (persisted). */
  perDay: number;
}

export const DEFAULT_SPEND_LIMITS: SpendLimits = {
  perRun: 2,
  perSession: 10,
  perDay: 25,
};

export type AuditEvent =
  | { type: "trust"; dir: string; decision: string }
  | { type: "permission"; request: PermissionRequest; decision: Decision }
  | {
      type: "model_call";
      provider: string;
      model: string;
      usage: TokenUsage;
      costUsd: number;
      durationMs: number;
    }
  | {
      type: "tool_call";
      tool: string;
      input: unknown;
      ok: boolean;
      summary: string;
    }
  | { type: "cost"; scope: "run" | "session" | "day"; totalUsd: number }
  | { type: "error"; message: string; where: string };
