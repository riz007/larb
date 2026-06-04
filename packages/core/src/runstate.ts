import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { projectLarbDir } from "@larb/governors";
import type { Message } from "@larb/providers";
import type { RunMode } from "./agent.js";

/**
 * A durable snapshot of an orchestrator run (SPEC §7.1). Persisted after every
 * iteration so a session that is interrupted — ctrl-C, a crash, or hitting the
 * iteration / spend limit — can be resumed exactly where it left off, and so a
 * completed run can be replayed/inspected. The message history is the source of
 * truth; everything else is derived bookkeeping.
 */
export interface RunState {
  id: string;
  task: string;
  mode: RunMode;
  model: string;
  messages: Message[];
  iteration: number;
  editsMade: boolean;
  verified: "passed" | "failed" | "skipped";
  status: "running" | "done" | "interrupted";
  startedAt: string;
  updatedAt: string;
}

/** Append-friendly, human-readable run snapshots under <project>/.larb/runs. */
export class RunStateStore {
  private readonly dir: string;

  constructor(projectRoot: string) {
    this.dir = join(projectLarbDir(projectRoot), "runs");
    mkdirSync(this.dir, { recursive: true });
  }

  /** A fresh run id (also the snapshot filename stem). */
  static newId(): string {
    return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  save(state: RunState): void {
    writeFileSync(this.file(state.id), JSON.stringify(state, null, 2), "utf8");
  }

  load(id: string): RunState | undefined {
    const f = this.file(id);
    if (!existsSync(f)) return undefined;
    try {
      return JSON.parse(readFileSync(f, "utf8")) as RunState;
    } catch {
      return undefined;
    }
  }

  /** All runs, newest first. */
  list(): RunState[] {
    if (!existsSync(this.dir)) return [];
    const states: RunState[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(".json")) continue;
      const s = this.load(name.slice(0, -".json".length));
      if (s) states.push(s);
    }
    return states.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Most recent run, or the most recent resumable (interrupted) one. */
  latest(resumableOnly = false): RunState | undefined {
    return this.list().find((s) => (resumableOnly ? s.status === "interrupted" : true));
  }
}
