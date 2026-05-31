import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { larbHome } from "./paths.js";
import type { AuditLog } from "./audit.js";
import {
  DEFAULT_SPEND_LIMITS,
  type SpendLimits,
  type TokenUsage,
} from "./types.js";

export class SpendLimitError extends Error {
  constructor(
    public readonly scope: "run" | "session" | "day",
    public readonly totalUsd: number,
    public readonly limitUsd: number,
  ) {
    super(
      `Hard spend limit reached: ${scope} total $${totalUsd.toFixed(4)} ≥ ` +
        `limit $${limitUsd.toFixed(2)}. Agent halted.`,
    );
    this.name = "SpendLimitError";
  }
}

interface DaySpend {
  date: string;
  totalUsd: number;
}

/**
 * Live token + $ accounting with HARD limits.
 *
 * The governor halts the agent before overspend — it does not merely warn, so a
 * runaway autonomous loop cannot quietly burn through the budget. Daily spend is
 * persisted to ~/.larb so limits survive process restarts.
 */
export class CostGovernor {
  private runUsd = 0;
  private sessionUsd = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private readonly spendFile: string;

  constructor(
    private readonly limits: SpendLimits = DEFAULT_SPEND_LIMITS,
    private readonly audit?: AuditLog,
  ) {
    this.spendFile = join(larbHome(), "spend.json");
  }

  /** Reset per-run counters (call at the start of each `run`). */
  beginRun(): void {
    this.runUsd = 0;
  }

  /** Record a model call's usage and cost, then enforce limits. */
  record(usage: TokenUsage, costUsd: number): void {
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.runUsd += costUsd;
    this.sessionUsd += costUsd;
    const dayTotal = this.addDaySpend(costUsd);

    this.audit?.log({ type: "cost", scope: "session", totalUsd: this.sessionUsd });
    this.enforce(dayTotal);
  }

  private enforce(dayTotal: number): void {
    if (this.runUsd >= this.limits.perRun)
      throw new SpendLimitError("run", this.runUsd, this.limits.perRun);
    if (this.sessionUsd >= this.limits.perSession)
      throw new SpendLimitError("session", this.sessionUsd, this.limits.perSession);
    if (dayTotal >= this.limits.perDay)
      throw new SpendLimitError("day", dayTotal, this.limits.perDay);
  }

  private addDaySpend(costUsd: number): number {
    const today = new Date().toISOString().slice(0, 10);
    let day: DaySpend = { date: today, totalUsd: 0 };
    if (existsSync(this.spendFile)) {
      try {
        const prev = JSON.parse(readFileSync(this.spendFile, "utf8")) as DaySpend;
        if (prev.date === today) day = prev;
      } catch {
        /* ignore corrupt file */
      }
    }
    day.totalUsd += costUsd;
    writeFileSync(this.spendFile, JSON.stringify(day), "utf8");
    return day.totalUsd;
  }

  snapshot(): {
    runUsd: number;
    sessionUsd: number;
    inputTokens: number;
    outputTokens: number;
    limits: SpendLimits;
  } {
    return {
      runUsd: this.runUsd,
      sessionUsd: this.sessionUsd,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      limits: this.limits,
    };
  }
}
