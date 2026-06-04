import type {
  GenerateResult,
  Message,
  ModelProvider,
  ContentBlock,
} from "@larb/providers";
import { PermissionDeniedError, type AuditLog, type CostGovernor } from "@larb/governors";
import { type Compactor, guardUntrusted } from "@larb/context";
import type { LarbConfig } from "./config.js";
import type { ToolContext } from "./tools/types.js";
import { ToolRegistry } from "./tools/registry.js";
import { RunStateStore, type RunState } from "./runstate.js";

export type RunMode = "ask" | "run";

export interface OrchestratorCallbacks {
  /** Streamed assistant text deltas. */
  onText?: (delta: string) => void;
  /** A tool is about to run. */
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  /** A tool finished. */
  onToolResult?: (summary: string, ok: boolean) => void;
  /** Verification step lifecycle. */
  onVerify?: (command: string, ok: boolean) => void;
  /** Per-iteration cost snapshot note. */
  onCost?: (sessionUsd: number) => void;
  /** Informational note (e.g. context compaction, delegation). */
  onNote?: (note: string) => void;
}

export interface RunOptions {
  task: string;
  mode: RunMode;
  provider: ModelProvider;
  model: string;
  registry: ToolRegistry;
  toolContext: ToolContext;
  cost: CostGovernor;
  audit: AuditLog;
  config: LarbConfig;
  repoMap: string;
  memory: string;
  /** Optional proactive context compaction for long sessions. */
  compactor?: Compactor;
  /** Persist run snapshots here so the run can be resumed/replayed (§7.1). */
  store?: RunStateStore;
  /** Resume from a prior snapshot instead of starting fresh. */
  resume?: RunState;
  callbacks?: OrchestratorCallbacks;
}

export interface RunResult {
  finalText: string;
  iterations: number;
  editsMade: boolean;
  verified: "passed" | "failed" | "skipped";
}

const MAX_VERIFY_ATTEMPTS = 3;

/**
 * Agent orchestrator loop: plan → act → observe → verify → repeat.
 * Single-agent mode for v1; the same shape generalizes to multi-agent later.
 * The mandatory verification loop means a `run` is not "done" until the
 * project's configured checks pass (or the iteration budget is exhausted).
 */
export class Orchestrator {
  async run(opts: RunOptions): Promise<RunResult> {
    const { provider, model, registry, toolContext, cost, audit, config, callbacks } = opts;
    let messages: Message[] = opts.resume?.messages ?? [
      { role: "user", content: [{ type: "text", text: opts.task }] },
    ];
    const system = buildSystemPrompt(opts);
    const tools = registry.definitions();

    // Durable run state (§7.1): restore on resume, snapshot every iteration so an
    // interrupted run can be picked up exactly where it stopped.
    const runId = opts.resume?.id ?? RunStateStore.newId();
    const startedAt = opts.resume?.startedAt ?? new Date().toISOString();
    const startIteration = (opts.resume?.iteration ?? 0) + 1;

    let editsMade = opts.resume?.editsMade ?? false;
    let verifyAttempts = 0;
    let verified: RunResult["verified"] = opts.resume?.verified ?? "skipped";
    let finalText = "";
    let iteration = startIteration;

    const persist = (status: RunState["status"]) =>
      opts.store?.save({
        id: runId,
        task: opts.task,
        mode: opts.mode,
        model,
        messages,
        iteration,
        editsMade,
        verified,
        status,
        startedAt,
        updatedAt: new Date().toISOString(),
      });

    try {
      for (iteration = startIteration; iteration <= config.maxIterations; iteration++) {
        // Proactively compact long sessions before they overflow the window.
        if (opts.compactor) {
        const c = await opts.compactor.maybeCompact(system, messages);
        if (c.compacted) {
          messages = c.messages;
          if (c.usage && typeof c.costUsd === "number") {
            cost.record(c.usage, c.costUsd);
            audit.log({
              type: "model_call",
              provider: provider.name,
              model: "compaction",
              usage: c.usage,
              costUsd: c.costUsd,
              durationMs: 0,
            });
          }
          if (c.note) callbacks?.onNote?.(c.note);
        }
      }

      const result = await this.callModel(provider, { system, messages, tools, model }, opts);

      cost.record(result.usage, result.costUsd);
      audit.log({
        type: "model_call",
        provider: provider.name,
        model: result.model,
        usage: result.usage,
        costUsd: result.costUsd,
        durationMs: 0,
      });
      callbacks?.onCost?.(cost.snapshot().sessionUsd);

      messages.push({ role: "assistant", content: result.content });
      finalText = textOf(result.content) || finalText;

      const toolUses = result.content.filter(
        (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use",
      );

      if (toolUses.length === 0) {
        // Model is done speaking. Enforce verification before accepting.
        if (
          opts.mode === "run" &&
          editsMade &&
          config.verify.length > 0 &&
          verifyAttempts < MAX_VERIFY_ATTEMPTS
        ) {
          verifyAttempts++;
          const { ok, report } = await this.verify(opts);
          verified = ok ? "passed" : "failed";
          if (!ok) {
            messages.push({
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "Verification failed. Fix the issues, then continue.\n\n" + report,
                },
              ],
            });
            persist("running");
            continue;
          }
        }
        persist("done");
        return { finalText, iterations: iteration, editsMade, verified };
      }

      // Execute each requested tool and feed results back as a user turn.
      const toolResults: ContentBlock[] = [];
      for (const call of toolUses) {
        const input = (call.input ?? {}) as Record<string, unknown>;
        callbacks?.onToolStart?.(call.name, input);
        const tool = registry.get(call.name);
        let content: string;
        let ok: boolean;
        let summary: string;
        if (!tool) {
          ok = false;
          content = `Unknown tool: ${call.name}`;
          summary = content;
        } else {
          try {
            const r = await tool.execute(input, toolContext);
            ok = r.ok;
            content = r.content;
            summary = r.summary;
            if (call.name === "write_file" && r.ok) editsMade = true;
          } catch (err) {
            ok = false;
            content =
              err instanceof PermissionDeniedError
                ? `Denied by user: ${err.message}`
                : `Tool error: ${(err as Error).message}`;
            summary = content;
          }
        }
        audit.log({ type: "tool_call", tool: call.name, input, ok, summary });
        callbacks?.onToolResult?.(summary, ok);
        // Guard untrusted tool output against injected instructions before it
        // re-enters the model context.
        const guarded = guardUntrusted(content);
        if (guarded.flagged) callbacks?.onNote?.(`Flagged possible prompt injection in ${call.name} output.`);
        toolResults.push({
          type: "tool_result",
          toolUseId: call.id,
          content: guarded.text,
          isError: !ok,
        });
      }
        messages.push({ role: "user", content: toolResults });
        persist("running");
      }

      // Iteration budget exhausted — resumable, not done.
      persist("interrupted");
      return { finalText, iterations: config.maxIterations, editsMade, verified };
    } catch (err) {
      // Spend limit, crash, or cancellation — leave a resumable snapshot.
      persist("interrupted");
      throw err;
    }
  }

  private async callModel(
    provider: ModelProvider,
    req: { system: string; messages: Message[]; tools: ReturnType<ToolRegistry["definitions"]>; model: string },
    opts: RunOptions,
  ): Promise<GenerateResult> {
    let final: GenerateResult | undefined;
    for await (const ev of provider.stream(req)) {
      if (ev.type === "text") opts.callbacks?.onText?.(ev.text);
      else if (ev.type === "final") final = ev.result;
    }
    if (!final) throw new Error("model stream ended without a final result");
    return final;
  }

  /** Run the configured verification commands through the sandbox. */
  private async verify(opts: RunOptions): Promise<{ ok: boolean; report: string }> {
    const reports: string[] = [];
    let allOk = true;
    for (const command of opts.config.verify) {
      await opts.toolContext.permission.require({
        capability: "exec",
        path: opts.toolContext.projectRoot,
        command,
        reason: `verification: ${command}`,
      });
      const res = await opts.toolContext.sandbox.run(command);
      const ok = res.code === 0 && !res.timedOut;
      allOk = allOk && ok;
      opts.callbacks?.onVerify?.(command, ok);
      reports.push(
        `$ ${command}\n[exit ${res.timedOut ? "timeout" : res.code}]\n` +
          (ok ? "" : [res.stdout, res.stderr].filter(Boolean).join("\n").slice(0, 4000)),
      );
    }
    return { ok: allOk, report: reports.join("\n\n") };
  }
}

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function buildSystemPrompt(opts: RunOptions): string {
  const { mode, toolContext, repoMap, memory } = opts;
  const modeBlurb =
    mode === "ask"
      ? "MODE: ask (read-only). You may read, list, and search files to answer " +
        "the user's question. You cannot write files or run commands."
      : "MODE: run (autonomous). You may read, write, search, and run commands. " +
        "Every write shows a diff and every command needs the user's approval. " +
        "Make the smallest change that satisfies the task, then stop.";

  return [
    "You are Larb, an open-source, security-first autonomous coding agent.",
    "Operate by: plan → act via tools → observe results → verify → repeat.",
    "",
    modeBlurb,
    "",
    `Project root: ${toolContext.projectRoot}`,
    "",
    "Principles you must follow:",
    "- Verify, don't assume: after edits, expect the verification loop to run " +
      "lint/build/test; do not claim success until checks pass.",
    "- Be surgical: prefer minimal, well-scoped diffs that match surrounding code.",
    "- Be honest: if you cannot complete the task or a check fails, say so plainly.",
    "- Respect permissions: if a tool is denied, adapt rather than retry blindly.",
    opts.registry.get("delegate")
      ? "- Delegate wisely: for large or parallelizable subtasks, call `delegate` " +
        "with a complete, self-contained instruction to hand work to a cheaper " +
        "worker agent. Keep planning and final synthesis yourself."
      : "",
    "",
    "Repo map (structural index):",
    repoMap || "(empty)",
    memory ? "\nProject memory:\n" + memory : "",
    "",
    "When the task is complete, give a short summary and stop calling tools.",
  ].join("\n");
}
