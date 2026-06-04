import { RunStateStore } from "@larb/core";

/** `larb runs` — list persisted run snapshots (newest first). */
export function runsCommand(projectRoot: string): void {
  const runs = new RunStateStore(projectRoot).list();
  if (!runs.length) {
    console.log("No runs recorded yet. Start one with `larb run <task>`.");
    return;
  }
  for (const r of runs) {
    const mark = r.status === "interrupted" ? "⏸ resumable" : r.status;
    console.log(`${r.id}  [${mark}]  iter ${r.iteration} · ${r.verified}`);
    console.log(`  ${truncate(r.task, 100)}`);
  }
  const resumable = runs.find((r) => r.status === "interrupted");
  if (resumable) console.log(`\nResume the latest with: larb resume`);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
