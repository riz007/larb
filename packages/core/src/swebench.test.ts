import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSweBench, toBenchTask, applyPatch, isResolved } from "./swebench.js";

describe("parseSweBench", () => {
  it("parses JSONL and normalizes FAIL_TO_PASS whether array or JSON string", () => {
    const jsonl = [
      JSON.stringify({
        instance_id: "django__django-1",
        repo: "django/django",
        base_commit: "abc123",
        problem_statement: "Fix the bug.",
        test_patch: "diff",
        FAIL_TO_PASS: ["test_a", "test_b"],
        PASS_TO_PASS: '["test_c"]',
      }),
      "",
    ].join("\n");
    const instances = parseSweBench(jsonl);
    expect(instances).toHaveLength(1);
    const i = instances[0]!;
    expect(i.instanceId).toBe("django__django-1");
    expect(i.baseCommit).toBe("abc123");
    expect(i.failToPass).toEqual(["test_a", "test_b"]);
    expect(i.passToPass).toEqual(["test_c"]); // decoded from a JSON string
    expect(toBenchTask(i)).toEqual({ id: "django__django-1", task: "Fix the bug." });
  });
});

describe("isResolved", () => {
  const inst = { failToPass: ["t1", "t2"], passToPass: ["t3"] };
  it("resolves only when all FAIL_TO_PASS and PASS_TO_PASS pass", () => {
    expect(isResolved(inst, ["t1", "t2", "t3"])).toBe(true);
    expect(isResolved(inst, ["t1", "t3"])).toBe(false); // t2 missing
    expect(isResolved(inst, ["t1", "t2"])).toBe(false); // regressed t3
  });
});

describe("applyPatch", () => {
  it("applies a unified diff to a git worktree", () => {
    const dir = mkdtempSync(join(tmpdir(), "larb-swe-"));
    const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    writeFileSync(join(dir, "f.txt"), "line1\n");
    git("add", "-A");
    git("commit", "-q", "-m", "init");

    const patch = [
      "diff --git a/f.txt b/f.txt",
      "index 0000000..1111111 100644",
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1 +1,2 @@",
      " line1",
      "+line2",
      "",
    ].join("\n");

    expect(applyPatch(dir, patch)).toBe(true);
    expect(readFileSync(join(dir, "f.txt"), "utf8")).toBe("line1\nline2\n");
  });

  it("returns false for a patch that does not apply", () => {
    const dir = mkdtempSync(join(tmpdir(), "larb-swe-"));
    execFileSync("git", ["-C", dir, "init", "-q"]);
    expect(applyPatch(dir, "diff --git a/nope b/nope\n--- a/nope\n+++ b/nope\n@@ -1 +1 @@\n-x\n+y\n")).toBe(false);
  });
});
