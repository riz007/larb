/**
 * Benchmark harness for the §14 success metrics: resolution rate and cost per
 * resolved task. It is provider/agent-agnostic — you supply a runner that
 * executes one task and reports its outcome, and the harness aggregates. That
 * keeps the measurement logic pure and testable; the CLI wires a real runner
 * (an agent session per task) on top, and a SWE-bench-style suite is just a
 * different task list + runner.
 */
export interface BenchTask {
  id: string;
  /** The instruction handed to the agent. */
  task: string;
}

export interface BenchOutcome {
  /** Did the task verifiably pass (verification/grader succeeded)? */
  resolved: boolean;
  costUsd: number;
  iterations: number;
  durationMs: number;
  /** Set when the run errored rather than completing. */
  error?: string;
}

export interface BenchResult extends BenchOutcome {
  id: string;
}

export interface BenchmarkReport {
  results: BenchResult[];
  total: number;
  resolved: number;
  /** resolved / total, in [0,1]. */
  resolutionRate: number;
  totalCostUsd: number;
  /** total cost ÷ resolved tasks (0 when nothing resolved). */
  costPerResolvedUsd: number;
  meanCostUsd: number;
  totalDurationMs: number;
}

export type TaskRunner = (task: BenchTask) => Promise<BenchOutcome>;

/**
 * Run each task sequentially (so cost accounting stays clean) and aggregate.
 * A thrown runner counts as unresolved with the error recorded, so one bad task
 * never aborts the suite.
 */
export async function runBenchmark(tasks: BenchTask[], run: TaskRunner): Promise<BenchmarkReport> {
  const results: BenchResult[] = [];
  for (const task of tasks) {
    try {
      const outcome = await run(task);
      results.push({ id: task.id, ...outcome });
    } catch (err) {
      results.push({
        id: task.id,
        resolved: false,
        costUsd: 0,
        iterations: 0,
        durationMs: 0,
        error: (err as Error).message,
      });
    }
  }
  return summarize(results);
}

export function summarize(results: BenchResult[]): BenchmarkReport {
  const total = results.length;
  const resolved = results.filter((r) => r.resolved).length;
  const totalCostUsd = results.reduce((s, r) => s + r.costUsd, 0);
  const totalDurationMs = results.reduce((s, r) => s + r.durationMs, 0);
  return {
    results,
    total,
    resolved,
    resolutionRate: total ? resolved / total : 0,
    totalCostUsd,
    costPerResolvedUsd: resolved ? totalCostUsd / resolved : 0,
    meanCostUsd: total ? totalCostUsd / total : 0,
    totalDurationMs,
  };
}

/** A compact, human-readable summary line set for the CLI / CI logs. */
export function formatReport(report: BenchmarkReport): string {
  const lines = report.results.map(
    (r) =>
      `  ${r.resolved ? "✓" : "✗"} ${r.id}  $${r.costUsd.toFixed(4)} · ${r.iterations} iter` +
      (r.error ? ` · error: ${r.error}` : ""),
  );
  lines.push(
    "",
    `resolved: ${report.resolved}/${report.total} (${(report.resolutionRate * 100).toFixed(1)}%)`,
    `total cost: $${report.totalCostUsd.toFixed(4)} · mean $${report.meanCostUsd.toFixed(4)}/task` +
      ` · $${report.costPerResolvedUsd.toFixed(4)}/resolved`,
  );
  return lines.join("\n");
}
