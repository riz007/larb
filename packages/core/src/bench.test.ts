import { describe, it, expect } from "vitest";
import { runBenchmark, summarize, type BenchOutcome, type BenchResult } from "./bench.js";

const ok = (costUsd: number, iterations = 1): BenchOutcome => ({
  resolved: true,
  costUsd,
  iterations,
  durationMs: 10,
});

describe("runBenchmark", () => {
  it("aggregates resolution rate and cost-per-resolved", async () => {
    const tasks = [
      { id: "a", task: "x" },
      { id: "b", task: "y" },
      { id: "c", task: "z" },
    ];
    const report = await runBenchmark(tasks, async (t) =>
      t.id === "c" ? { resolved: false, costUsd: 0.1, iterations: 2, durationMs: 5 } : ok(0.2),
    );
    expect(report.total).toBe(3);
    expect(report.resolved).toBe(2);
    expect(report.resolutionRate).toBeCloseTo(2 / 3);
    expect(report.totalCostUsd).toBeCloseTo(0.5);
    expect(report.costPerResolvedUsd).toBeCloseTo(0.25); // 0.5 / 2 resolved
    expect(report.meanCostUsd).toBeCloseTo(0.5 / 3);
  });

  it("records a thrown task as unresolved without aborting the suite", async () => {
    const tasks = [
      { id: "a", task: "x" },
      { id: "boom", task: "y" },
      { id: "c", task: "z" },
    ];
    const report = await runBenchmark(tasks, async (t) => {
      if (t.id === "boom") throw new Error("kaboom");
      return ok(0.1);
    });
    expect(report.total).toBe(3);
    expect(report.resolved).toBe(2);
    expect(report.results.find((r) => r.id === "boom")?.error).toBe("kaboom");
  });

  it("reports zero cost-per-resolved when nothing resolves", () => {
    const results: BenchResult[] = [
      { id: "a", resolved: false, costUsd: 0.3, iterations: 1, durationMs: 1 },
    ];
    const report = summarize(results);
    expect(report.costPerResolvedUsd).toBe(0);
    expect(report.resolutionRate).toBe(0);
  });
});
