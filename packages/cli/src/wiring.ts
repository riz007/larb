import {
  AuditLog,
  CostGovernor,
  PermissionEngine,
  type Approver,
  type ProjectPolicy,
} from "@larb/governors";
import { ProviderRouter } from "@larb/providers";
import { Sandbox, type IsolationInfo } from "@larb/sandbox";
import {
  ProjectMemory,
  buildRepoMap,
  renderRepoMap,
  Compactor,
  loadAgentInstructions,
} from "@larb/context";
import { loadAllSkills, loadSkillTools } from "@larb/skills";
import { McpManager } from "@larb/mcp";
import {
  Orchestrator,
  ToolRegistry,
  RunStateStore,
  loadConfig,
  readOnlyTools,
  fullTools,
  orchestratorTools,
  type LarbConfig,
  type OrchestratorCallbacks,
  type RunMode,
  type RunResult,
  type RunState,
  type ToolContext,
} from "@larb/core";

export interface SessionCallbacks extends OrchestratorCallbacks {
  onDiff?: (path: string, diff: string) => void;
  onNote?: (note: string) => void;
}

/** A snapshot of the active provider + routing, for display. */
export interface ProviderInfo {
  kind: string;
  label: string;
  orchestrator: string;
  worker: string;
}

export interface Session {
  config: LarbConfig;
  cost: CostGovernor;
  audit: AuditLog;
  provider: ProviderInfo;
  /** Active execution-isolation level, for an informed trust decision. */
  isolation: IsolationInfo;
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
  /** Resume a prior interrupted run instead of starting fresh. */
  resume?: RunState;
}): Session {
  const { projectRoot, mode, approver, callbacks, resume } = opts;
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

  const sandbox = new Sandbox({ projectRoot, ...config.sandbox });
  const toolContext: ToolContext = {
    projectRoot,
    permission,
    sandbox,
    audit,
    memory: new ProjectMemory(projectRoot),
    onDiff: callbacks.onDiff,
    onNote: callbacks.onNote,
  };

  const registry = new ToolRegistry(
    mode === "ask" ? readOnlyTools() : orchestratorTools(),
  );
  const repoMap = renderRepoMap(buildRepoMap(projectRoot));
  const agentInstructions = loadAgentInstructions(projectRoot);
  let memory = toolContext.memory.load();
  const orchestrator = new Orchestrator();
  // Persist run snapshots (run mode only) so a session can be resumed/replayed.
  const store = mode === "run" ? new RunStateStore(projectRoot) : undefined;

  // Compaction summarizes with the cheap worker model to keep long sessions cheap.
  const compactor = new Compactor({
    projectRoot,
    provider: router.provider,
    model: router.modelFor("worker"),
  });

  // Multi-agent: the orchestrator may delegate scoped subtasks to a worker agent
  // running the cheap model. The worker shares the permission engine and cost
  // governor; it gets no delegate tool of its own, which bounds recursion.
  if (mode === "run") {
    const workerRegistry = new ToolRegistry(fullTools());
    const workerContext: ToolContext = { ...toolContext, delegate: undefined };
    toolContext.delegate = async (subtask: string) => {
      const result = await new Orchestrator().run({
        task: subtask,
        mode: "run",
        provider: router.provider,
        model: router.modelFor("worker"),
        registry: workerRegistry,
        toolContext: workerContext,
        cost,
        audit,
        config: { ...config, maxIterations: Math.min(config.maxIterations, 12) },
        repoMap,
        memory,
        agentInstructions,
        compactor,
        callbacks,
      });
      return {
        ok: result.verified !== "failed",
        summary: `worker ran ${result.iterations} step(s), verify: ${result.verified}`,
        content: result.finalText,
      };
    };
  }

  // Load installed skills (run mode only). Plugin tools are registered but
  // execute in an isolated child process under manifest + permission enforcement;
  // declarative SKILL.md instructions are injected into context.
  if (mode === "run") {
    const skills = loadAllSkills(projectRoot);
    const prepared = loadSkillTools(
      skills,
      { projectRoot, permission, sandbox: toolContext.sandbox },
      callbacks.onNote,
    );
    for (const p of prepared) {
      registry.add({
        name: p.name,
        description: p.description,
        inputSchema: p.inputSchema,
        execute: (input) => p.execute(input),
      });
    }
    const docs = skills
      .filter((s) => s.instructions.trim())
      .map((s) => `### skill: ${s.manifest.name} (${s.tier})\n${s.instructions.trim()}`)
      .join("\n\n");
    if (docs) memory = `${memory}\n\n## Installed skills\n${docs}`;
  }

  // MCP servers (run mode only): connected lazily at the start of run() and torn
  // down when it finishes — never at boot, never before a trust decision. Each
  // remote tool is registered as a permission-gated tool like any other.
  const mcpManager =
    mode === "run" && config.mcp.length > 0
      ? new McpManager(config.mcp, { permission, onNote: callbacks.onNote })
      : undefined;

  cost.beginRun();

  return {
    config,
    cost,
    audit,
    provider: {
      kind: router.kind,
      label: router.label,
      orchestrator: router.modelFor("orchestrator"),
      worker: router.modelFor("worker"),
    },
    isolation: sandbox.isolation,
    run: async (task: string) => {
      if (mcpManager) {
        await mcpManager.connectAll();
        for (const t of mcpManager.tools()) {
          registry.add({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            execute: (input) => t.execute(input),
          });
        }
      }
      try {
        return await orchestrator.run({
          task: resume?.task ?? task,
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
          agentInstructions,
          compactor,
          store,
          resume,
          callbacks,
        });
      } finally {
        await mcpManager?.closeAll();
      }
    },
  };
}
