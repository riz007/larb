import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A throwaway git worktree — an isolated checkout of the repo at a ref, on its
 * own path. It lets benchmark tasks run without contaminating each other or the
 * user's tree, and is the substrate for parallel multi-agent work (each worker
 * gets its own tree, results merged deliberately). Always {@link dispose} it.
 */
export class Worktree {
  private disposed = false;
  private constructor(
    readonly path: string,
    private readonly repoRoot: string,
  ) {}

  /** True if `dir` is inside a git work tree. */
  static isGitRepo(dir: string): boolean {
    const r = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
    return r.status === 0 && r.stdout.trim() === "true";
  }

  /** Create a detached worktree of `repoRoot` at `ref` (default HEAD). */
  static create(repoRoot: string, opts: { ref?: string } = {}): Worktree {
    const path = mkdtempSync(join(tmpdir(), "larb-wt-"));
    const ref = opts.ref ?? "HEAD";
    const r = spawnSync(
      "git",
      ["-C", repoRoot, "worktree", "add", "--detach", path, ref],
      { encoding: "utf8" },
    );
    if (r.status !== 0) {
      rmSync(path, { recursive: true, force: true });
      throw new Error(`git worktree add failed: ${r.stderr || r.error?.message || "unknown error"}`);
    }
    return new Worktree(path, repoRoot);
  }

  /** Remove the worktree and its directory. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    spawnSync("git", ["-C", this.repoRoot, "worktree", "remove", "--force", this.path], {
      encoding: "utf8",
    });
    rmSync(this.path, { recursive: true, force: true });
  }
}
