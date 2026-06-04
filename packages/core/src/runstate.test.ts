import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStateStore, type RunState } from "./runstate.js";

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "larb-runs-"));
});

function sample(overrides: Partial<RunState> = {}): RunState {
  const now = new Date().toISOString();
  return {
    id: RunStateStore.newId(),
    task: "do a thing",
    mode: "run",
    model: "test-model",
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    iteration: 1,
    editsMade: false,
    verified: "skipped",
    status: "running",
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("RunStateStore", () => {
  it("round-trips a run snapshot", () => {
    const store = new RunStateStore(project);
    const state = sample();
    store.save(state);
    const loaded = store.load(state.id);
    expect(loaded).toEqual(state);
  });

  it("lists runs newest-first", async () => {
    const store = new RunStateStore(project);
    const a = sample({ updatedAt: "2026-01-01T00:00:00.000Z" });
    const b = sample({ updatedAt: "2026-06-01T00:00:00.000Z" });
    store.save(a);
    store.save(b);
    const ids = store.list().map((r) => r.id);
    expect(ids[0]).toBe(b.id);
    expect(ids[1]).toBe(a.id);
  });

  it("finds the latest resumable (interrupted) run, skipping done ones", () => {
    const store = new RunStateStore(project);
    store.save(sample({ status: "done", updatedAt: "2026-06-02T00:00:00.000Z" }));
    const interrupted = sample({ status: "interrupted", updatedAt: "2026-06-01T00:00:00.000Z" });
    store.save(interrupted);
    expect(store.latest(true)?.id).toBe(interrupted.id);
    // Without the resumable filter, the done run (newer) wins.
    expect(store.latest()?.status).toBe("done");
  });

  it("returns undefined for an unknown id", () => {
    expect(new RunStateStore(project).load("nope")).toBeUndefined();
  });
});
