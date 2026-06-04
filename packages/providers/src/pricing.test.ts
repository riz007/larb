import { describe, it, expect } from "vitest";
import { estimateCost } from "./pricing.js";

describe("estimateCost — cache-aware", () => {
  it("bills plain input + output at list price", () => {
    // sonnet: $3/M in, $15/M out
    const cost = estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, "claude-sonnet-4");
    expect(cost).toBeCloseTo(18);
  });

  it("bills cache reads at ~1/10th of input and writes at a premium", () => {
    const base = estimateCost({ inputTokens: 1_000_000, outputTokens: 0 }, "claude-sonnet-4");
    const cacheRead = estimateCost(
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 },
      "claude-sonnet-4",
    );
    const cacheWrite = estimateCost(
      { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 },
      "claude-sonnet-4",
    );
    expect(cacheRead).toBeCloseTo(base * 0.1);
    expect(cacheWrite).toBeCloseTo(base * 1.25);
  });

  it("a cached prefix is far cheaper than re-sending it as fresh input", () => {
    const fresh = estimateCost({ inputTokens: 100_000, outputTokens: 0 }, "claude-opus-4-8");
    const cached = estimateCost(
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 100_000 },
      "claude-opus-4-8",
    );
    expect(cached).toBeLessThan(fresh);
  });
});
