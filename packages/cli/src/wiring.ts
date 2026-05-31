import {
  AuditLog,
  CostGovernor,
  PermissionEngine,
  type Approver,
  type ProjectPolicy,
} from "@larb/governors";
import { ProviderRouter } from "@larb/providers";
import { Sandbox } from "@larb/sandbox";
import { ProjectMemory, buildRepoMap, renderRepoMap } from "@larb/context";
import {
  Orchestrator,
  ToolRegistry,
  loadConfig,
  readOnlyTools,
  fullTools,
  type LarbConfig,
  type OrchestratorCallbacks,
  type RunMode,
  type RunResult,
  type ToolContext,
} from "@larb/core";

export interface SessionCallbacks extends OrchestratorCallbacks {
  onDiff?: (path: string, diff: string) => void;
  onNote?: (note: string) => void;
}

export interface Session {
  config: LarbConfig;
  cost: CostGovernor;
  audit: AuditLog;
  run(task: string): Promise<RunResult>;
}

/**
 * Assemble a fully-governed agent session (called only AFTER a trust decision).
 * Wires the provider, governors, sandbox, context, tools, and orchestrator. No
 * network call happens here — the provider client is constructed lazily.
 */
export function buildSession(opts: {
  projectRoot: string;
  mode: RunMode;
  approver: Approver;
  callbacks: SessionCallbacks;
}): Session {
  const { projectRoot, mode, approver, callbacks } = opts;
  const config = loadConfig(projectRoot);

  const audit = new AuditLog(projectRoot);
  const cost = new CostGovernor(config.limits, audit);
  const router = new ProviderRouter(config.provider);

  // fs.read is pre-allowed within the project; writes/exec/net are prompted.
  const policy: ProjectPolicy = {
    ...config.policy,
    allow: [
      { capability: "fs.read", pathPrefix: projectRoot },
      ...(config.policy.allow ?? []),
    ],
  };
  const permission = new PermissionEngine({
    projectRoot,
    approver,
    audit,
    policy,
    autoDenyUnknown: mode === "ask",
  });

  const toolContext: ToolContext = {
    projectRoot,
    permission,
    sandbox: new Sandbox({ projectRoot }),
    audit,
    memory: new ProjectMemory(projectRoot),
    onDiff: callbacks.onDiff,
    onNote: callbacks.onNote,
  };

  const registry = new ToolRegistry(mode === "ask" ? readOnlyTools() : fullTools());
  const repoMap = renderRepoMap(buildRepoMap(projectRoot));
  const memory = toolContext.memory.load();
  const orchestrator = new Orchestrator();

  cost.beginRun();

  return {
    config,
    cost,
    audit,
    run: (task: string) =>
      orchestrator.run({
        task,
        mode,
        provider: router.provider,
        model: router.modelFor("orchestrator"),
        registry,
        toolContext,
        cost,
        audit,
        config,
        repoMap,
        memory,
        callbacks,
      }),
  };
}
