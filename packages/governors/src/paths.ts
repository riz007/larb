import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

/** Global Larb home (~/.larb) — user-scoped trust, permissions, daily spend. */
export function larbHome(): string {
  const dir = process.env.LARB_HOME ?? join(homedir(), ".larb");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Per-project Larb dir (<project>/.larb) — audit log, memory, repo map cache. */
export function projectLarbDir(projectDir: string): string {
  const dir = join(resolve(projectDir), ".larb");
  mkdirSync(dir, { recursive: true });
  return dir;
}
