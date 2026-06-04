import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { TrustEngine, type Approver } from "@larb/governors";
import {
  runBenchmark,
  formatReport,
  parseSweBench,
  toBenchTask,
  Worktree,
  type BenchTask,
  type BenchOutcome,
} from "@larb/core";
import { buildSession } from "../wiring.js";

/**
 * `larb bench <suite.json>` — measure resolution rate and cost/task (§14).
 *
 * The suite is `{ "tasks": [{ "id": "...", "task": "..." }] }`. With
 * `--swebench <file.jsonl>` the file is read as SWE-bench instances and their
 * problem statements become the tasks. Each task runs as an autonomous session
 * in its own git worktree; resolution = the verification loop passing.
 * Because it runs autonomously with auto-approval, point it at a disposable
 * checkout — it edits files and runs commands without prompting.
 *
 * NOTE: full SWE-bench grading (apply each instance's test_patch and check
 * FAIL_TO_PASS / PASS_TO_PASS) needs every instance's repo checked out at its
 * base commit; the `applyPatch`/`isResolved` primitives in @larb/core support
 * building that harness. This command runs the agent on the problem statements
 * and grades by the project's own verify loop.
 */
export function benchCommand(projectRoot: string, args: string[]): void {
  const swebench = args.includes("--swebench");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) return fail("Usage: larb bench <suite.json> | larb bench --swebench <file.jsonl>");
  const path = resolve(file);
  if (!existsSync(path)) return fail(`File not found: ${path}`);

  let tasks: BenchTask[];
  try {
    const text = readFileSync(path, "utf8");
    tasks = swebench
      ? parseSweBench(text).map(toBenchTask)
      : ((JSON.parse(text) as { tasks?: BenchTask[] }).tasks ?? []);
  } catch (err) {
    return fail(`Invalid ${swebench ? "SWE-bench JSONL" : "suite JSON"}: ${(err as Error).message}`);
  }
  if (!tasks.length) return fail("No tasks found.");

  const trust = new TrustEngine();
  if (trust.status(projectRoot)?.scope !== "full") {
    return fail("Benchmarking needs full trust. Run `larb trust --full` first (use a throwaway checkout!).");
  }

  // Each task runs in its own throwaway git worktree when possible, so tasks
  // never contaminate each other or the user's tree. Falls back to the cwd if
  // this isn't a git repo.
  const isolate = Worktree.isGitRepo(projectRoot);
  console.log(
    `⚠ Running ${tasks.length} task(s) autonomously with auto-approval` +
      (isolate ? " in isolated git worktrees." : ` in ${projectRoot} (not a git repo — no isolation!).`),
  );

  // Autonomous, non-interactive: approve capability requests automatically.
  const approver: Approver = async () => "allow-session";

  runBenchmark(tasks, (task) => runOne(projectRoot, task, approver, isolate))
    .then((report) => console.log("\n" + formatReport(report)))
    .catch((err) => fail(`Benchmark failed: ${(err as Error).message}`));
}

async function runOne(
  projectRoot: string,
  task: BenchTask,
  approver: Approver,
  isolate: boolean,
): Promise<BenchOutcome> {
  const started = Date.now();
  const worktree = isolate ? Worktree.create(projectRoot) : undefined;
  const workdir = worktree?.path ?? projectRoot;
  try {
    const session = buildSession({ projectRoot: workdir, mode: "run", approver, callbacks: {} });
    const result = await session.run(task.task);
    return {
      resolved: result.verified === "passed",
      costUsd: session.cost.snapshot().sessionUsd,
      iterations: result.iterations,
      durationMs: Date.now() - started,
    };
  } finally {
    worktree?.dispose();
  }
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}
