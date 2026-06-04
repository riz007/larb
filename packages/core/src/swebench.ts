import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BenchTask } from "./bench.js";

/**
 * SWE-bench-style evaluation (SPEC §14).
 *
 * A SWE-bench instance is a real repo at a base commit, a problem statement, a
 * `test_patch` that introduces the grading tests, and the test ids that must
 * flip to passing (`FAIL_TO_PASS`) while others stay green (`PASS_TO_PASS`).
 * Grading = let the agent edit the checkout, apply the test_patch, run the
 * tests, and check those sets.
 *
 * This module owns the dataset-agnostic pieces (parse the JSONL, map to bench
 * tasks, apply a patch, decide resolution from test results). Running a full
 * suite additionally needs the instances' repos checked out at their base
 * commits and a per-repo test command — see docs; those are supplied by the
 * caller/harness, not hardcoded here.
 */
export interface SweBenchInstance {
  instanceId: string;
  repo: string;
  baseCommit: string;
  problemStatement: string;
  testPatch: string;
  failToPass: string[];
  passToPass: string[];
}

/** Parse one JSONL line (SWE-bench's snake_case fields) into an instance. */
export function parseInstance(raw: unknown): SweBenchInstance {
  const o = raw as Record<string, unknown>;
  return {
    instanceId: String(o.instance_id ?? o.instanceId ?? ""),
    repo: String(o.repo ?? ""),
    baseCommit: String(o.base_commit ?? o.baseCommit ?? ""),
    problemStatement: String(o.problem_statement ?? o.problemStatement ?? ""),
    testPatch: String(o.test_patch ?? o.testPatch ?? ""),
    failToPass: toStringArray(o.FAIL_TO_PASS ?? o.failToPass),
    passToPass: toStringArray(o.PASS_TO_PASS ?? o.passToPass),
  };
}

/** Parse a SWE-bench JSONL document into instances. */
export function parseSweBench(jsonl: string): SweBenchInstance[] {
  return jsonl
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => parseInstance(JSON.parse(line)));
}

/** Map an instance to a bench task (the agent only ever sees the problem). */
export function toBenchTask(instance: SweBenchInstance): BenchTask {
  return { id: instance.instanceId, task: instance.problemStatement };
}

/** Apply a unified-diff patch to a git worktree. Returns true on success. */
export function applyPatch(dir: string, patch: string): boolean {
  if (!patch.trim()) return true;
  const file = join(mkdtempSync(join(tmpdir(), "larb-patch-")), "patch.diff");
  writeFileSync(file, patch.endsWith("\n") ? patch : patch + "\n");
  const r = spawnSync("git", ["-C", dir, "apply", "--whitespace=nowarn", file], { encoding: "utf8" });
  return r.status === 0;
}

/**
 * Resolution rule: the instance is resolved iff every FAIL_TO_PASS test now
 * passes and every PASS_TO_PASS test still passes.
 */
export function isResolved(
  instance: Pick<SweBenchInstance, "failToPass" | "passToPass">,
  passedTests: Iterable<string>,
): boolean {
  const passed = new Set(passedTests);
  return (
    instance.failToPass.every((t) => passed.has(t)) &&
    instance.passToPass.every((t) => passed.has(t))
  );
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  // SWE-bench often stores these as a JSON-encoded string.
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* fall through */
    }
  }
  return [];
}
