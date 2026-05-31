import { AuditLog, type AuditRecord } from "@larb/governors";

/** Print the append-only audit log + a cost summary. */
export function auditCommand(projectRoot: string): void {
  const log = new AuditLog(projectRoot);
  const records = log.readAll();
  if (records.length === 0) {
    console.log("No audit records yet for this project.");
    console.log(`(log file: ${log.path})`);
    return;
  }

  let totalCost = 0;
  const counts: Record<string, number> = {};
  for (const r of records) {
    counts[r.type as string] = (counts[r.type as string] ?? 0) + 1;
    if (r.type === "model_call" && typeof r.costUsd === "number") totalCost += r.costUsd;
  }

  console.log(`Audit log: ${log.path}`);
  console.log(`Events: ${records.length}`);
  for (const [type, n] of Object.entries(counts)) console.log(`  ${type}: ${n}`);
  console.log(`Estimated model spend: $${totalCost.toFixed(4)}`);
  console.log("");
  console.log("Recent events:");
  for (const r of records.slice(-15)) console.log("  " + formatRecord(r));
}

function formatRecord(r: AuditRecord): string {
  const ts = String(r.ts).slice(11, 19);
  switch (r.type) {
    case "trust":
      return `${ts} trust ${r.decision} ${r.dir}`;
    case "permission":
      return `${ts} permission ${r.decision} ${JSON.stringify(r.request)}`;
    case "model_call":
      return `${ts} model ${r.model} $${Number(r.costUsd).toFixed(4)}`;
    case "tool_call":
      return `${ts} tool ${r.tool} ${r.ok ? "ok" : "fail"} — ${r.summary}`;
    case "cost":
      return `${ts} cost ${r.scope} $${Number(r.totalUsd).toFixed(4)}`;
    case "error":
      return `${ts} error ${r.where}: ${r.message}`;
    default:
      return `${ts} ${JSON.stringify(r)}`;
  }
}
