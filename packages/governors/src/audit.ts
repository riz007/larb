import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { projectLarbDir } from "./paths.js";
import type { AuditEvent } from "./types.js";

export interface AuditRecord extends Record<string, unknown> {
  ts: string;
}

/**
 * Append-only, local, human-readable audit log.
 *
 * One JSON object per line (JSONL) under <project>/.larb/audit.jsonl. We never
 * rewrite or truncate — the log is the trust anchor for incident review, so it
 * is strictly append-only.
 */
export class AuditLog {
  private readonly file: string;

  constructor(projectDir: string) {
    this.file = join(projectLarbDir(projectDir), "audit.jsonl");
  }

  get path(): string {
    return this.file;
  }

  log(event: AuditEvent): void {
    const record: AuditRecord = { ts: new Date().toISOString(), ...event };
    appendFileSync(this.file, JSON.stringify(record) + "\n", "utf8");
  }

  /** Read the whole log back as parsed records (newest last). */
  readAll(): AuditRecord[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AuditRecord);
  }
}
