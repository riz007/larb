import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worktree } from "./worktree.js";

/** A throwaway git repo with one commit, for isolated worktree tests. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "larb-repo-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "marker.txt"), "hello");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return dir;
}

describe("Worktree", () => {
  it("detects a git repo", () => {
    const repo = makeRepo();
    expect(Worktree.isGitRepo(repo)).toBe(true);
    expect(Worktree.isGitRepo(tmpdir())).toBe(false);
  });

  it("creates an isolated checkout and removes it on dispose", () => {
    const repo = makeRepo();
    const wt = Worktree.create(repo);
    try {
      expect(wt.path).not.toBe(repo);
      // The checkout has the committed content.
      expect(existsSync(join(wt.path, "marker.txt"))).toBe(true);
      // Edits in the worktree do not touch the source tree.
      writeFileSync(join(wt.path, "scratch.txt"), "isolated");
      expect(existsSync(join(repo, "scratch.txt"))).toBe(false);
    } finally {
      wt.dispose();
    }
    expect(existsSync(wt.path)).toBe(false);
  });
});
