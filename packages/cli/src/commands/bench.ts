import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { TrustEngine, type Approver } from "@larb/governors";
import {
  runBenchmark,
  formatReport,
  type BenchTask,
  type BenchOutcome,
} from "@larb/core";
import { buildSession } from "../wiring.js";

/**
 * `larb bench <suite.json>` — measure resolution rate and cost/task (§14).
 *
 * The suite is `{ "tasks": [{ "id": "...", "task": "..." }] }`. Each task runs
 * as an autonomous session in the current project; resolution = the
 * verification loop passing. Because it runs autonomously with auto-approval,
 * it MUST be pointed at a disposable checkout — it will edit files and run
 * commands without prompting.
 */
export function benchCommand(projectRoot: string, args: string[]): void {
  const file = args[0];
  if (!file) return fail("Usage: larb bench <suite.json>");
  const path = resolve(file);
  if (!existsSync(path)) return fail(`Suite not found: ${path}`);

  let tasks: BenchTask[];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { tasks?: BenchTask[] };
    tasks = parsed.tasks ?? [];
  } catch (err) {
    return fail(`Invalid suite JSON: ${(err as Error).message}`);
  }
  if (!tasks.length) return fail("Suite has no tasks.");

  const trust = new TrustEngine();
  if (trust.status(projectRoot)?.scope !== "full") {
    return fail("Benchmarking needs full trust. Run `larb trust --full` first (use a throwaway checkout!).");
  }

  console.log(`⚠ Running ${tasks.length} task(s) autonomously with auto-approval in ${projectRoot}.`);

  // Autonomous, non-interactive: approve capability requests automatically.
  const approver: Approver = async () => "allow-session";

  runBenchmark(tasks, (task) => runOne(projectRoot, task, approver))
    .then((report) => console.log("\n" + formatReport(report)))
    .catch((err) => fail(`Benchmark failed: ${(err as Error).message}`));
}

async function runOne(
  projectRoot: string,
  task: BenchTask,
  approver: Approver,
): Promise<BenchOutcome> {
  const started = Date.now();
  const session = buildSession({
    projectRoot,
    mode: "run",
    approver,
    callbacks: {},
  });
  const result = await session.run(task.task);
  return {
    resolved: result.verified === "passed",
    costUsd: session.cost.snapshot().sessionUsd,
    iterations: result.iterations,
    durationMs: Date.now() - started,
  };
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}
