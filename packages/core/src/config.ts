import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  larbHome,
  DEFAULT_SPEND_LIMITS,
  type SpendLimits,
  type ProjectPolicy,
} from "@larb/governors";
import { DEFAULT_PROVIDER_CONFIG, type ProviderConfig } from "@larb/providers";
import type { SandboxConfig } from "@larb/sandbox";
import type { McpServerConfig } from "@larb/mcp";

export interface LarbConfig {
  provider: ProviderConfig;
  limits: SpendLimits;
  policy: ProjectPolicy;
  /** Verification commands run after edits (lint/typecheck/build/test). */
  verify: string[];
  maxIterations: number;
  /** Execution-isolation policy. Trusted (global) config only — see below. */
  sandbox: SandboxConfig;
  /**
   * MCP servers the agent may use. Trusted (global) config ONLY — a stdio server
   * spawns an arbitrary command, so repo config can never define one (that would
   * be RCE by `git clone`). See applyProjectProposals.
   */
  mcp: McpServerConfig[];
}

export const DEFAULT_CONFIG: LarbConfig = {
  provider: DEFAULT_PROVIDER_CONFIG,
  limits: DEFAULT_SPEND_LIMITS,
  policy: {},
  verify: [],
  maxIterations: 30,
  sandbox: { backend: "auto", network: "none" },
  mcp: [],
};

/**
 * Layered, NON-EXECUTABLE config.
 *
 * Two sources: the user's global ~/.larb/config.toml (fully trusted) and the
 * project's <root>/.larb/config.toml (PROPOSALS ONLY). Repo config can never:
 *   - change the API base URL or which env var holds the key,
 *   - add allow-rules or raise spend limits (it can only *lower* them),
 *   - trigger any execution.
 * It may only suggest models, verification commands, and a max iteration count.
 */
export function loadConfig(projectRoot: string): LarbConfig {
  const config: LarbConfig = structuredClone(DEFAULT_CONFIG);

  applyGlobal(config, readTomlSafe(join(larbHome(), "config.toml")));
  applyProjectProposals(config, readTomlSafe(join(projectRoot, ".larb", "config.toml")));

  return config;
}

function applyGlobal(config: LarbConfig, raw: Record<string, unknown> | undefined): void {
  if (!raw) return;
  const provider = raw.provider as Partial<ProviderConfig> | undefined;
  if (provider) {
    if (provider.kind) config.provider.kind = provider.kind;
    if (provider.apiKeyEnv) config.provider.apiKeyEnv = provider.apiKeyEnv;
    if (provider.baseURL) config.provider.baseURL = provider.baseURL;
    if (provider.models) config.provider.models = { ...config.provider.models, ...provider.models };
  }
  const limits = raw.limits as Partial<SpendLimits> | undefined;
  if (limits) config.limits = { ...config.limits, ...limits };
  const policy = raw.policy as ProjectPolicy | undefined;
  if (policy) config.policy = policy;
  if (Array.isArray(raw.verify)) config.verify = raw.verify.map(String);
  if (typeof raw.maxIterations === "number") config.maxIterations = raw.maxIterations;

  // Sandbox isolation policy is trusted-config-only: repo config can never
  // weaken isolation (see applyProjectProposals, which deliberately ignores it).
  const sandbox = raw.sandbox as Partial<SandboxConfig> | undefined;
  if (sandbox) {
    if (sandbox.backend) config.sandbox.backend = sandbox.backend;
    if (sandbox.runtime) config.sandbox.runtime = sandbox.runtime;
    if (sandbox.image) config.sandbox.image = sandbox.image;
    if (sandbox.network) config.sandbox.network = sandbox.network;
    if (Array.isArray(sandbox.egressAllow))
      config.sandbox.egressAllow = sandbox.egressAllow.map(String);
  }

  // MCP servers are trusted-config-only (a stdio server spawns a command).
  if (Array.isArray(raw.mcp)) config.mcp = parseMcpServers(raw.mcp);
}

/** Parse and validate `[[mcp]]` tables; silently drop malformed entries. */
function parseMcpServers(raw: unknown[]): McpServerConfig[] {
  const servers: McpServerConfig[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const command = typeof e.command === "string" ? e.command.trim() : "";
    if (!name || !command) continue; // v1 supports stdio only; both are required
    const server: McpServerConfig = { name, command };
    if (typeof e.transport === "string") server.transport = e.transport as "stdio";
    if (Array.isArray(e.args)) server.args = e.args.map(String);
    if (e.env && typeof e.env === "object") {
      server.env = Object.fromEntries(
        Object.entries(e.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
      );
    }
    servers.push(server);
  }
  return servers;
}

/** Sanitized application of untrusted repo config — proposals only. */
function applyProjectProposals(
  config: LarbConfig,
  raw: Record<string, unknown> | undefined,
): void {
  if (!raw) return;

  // Models may be proposed; baseURL / apiKeyEnv / kind are deliberately ignored.
  const provider = raw.provider as { models?: ProviderConfig["models"] } | undefined;
  if (provider?.models) {
    config.provider.models = { ...config.provider.models, ...provider.models };
  }

  // Spend limits may only be tightened, never raised.
  const limits = raw.limits as Partial<SpendLimits> | undefined;
  if (limits) {
    if (typeof limits.perRun === "number")
      config.limits.perRun = Math.min(config.limits.perRun, limits.perRun);
    if (typeof limits.perSession === "number")
      config.limits.perSession = Math.min(config.limits.perSession, limits.perSession);
    if (typeof limits.perDay === "number")
      config.limits.perDay = Math.min(config.limits.perDay, limits.perDay);
  }

  // Verification commands are proposals (still run inside the sandbox under exec
  // permission), and iteration budget may be proposed.
  if (Array.isArray(raw.verify)) config.verify = raw.verify.map(String);
  if (typeof raw.maxIterations === "number") config.maxIterations = raw.maxIterations;

  // NOTE: policy.allow / policy.deny, the [sandbox] isolation policy, and [[mcp]]
  // servers from repo config are intentionally ignored — untrusted config can
  // never grant authority, weaken execution isolation, or spawn a process.
}

function readTomlSafe(file: string): Record<string, unknown> | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return parseToml(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
