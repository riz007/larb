import { TrustEngine, type Approver } from "@larb/governors";
import type { RunState } from "@larb/core";
import { buildSession } from "../wiring.js";

export interface HeadlessOptions {
  json: boolean;
  resume?: RunState;
}

/**
 * `larb run <task> --yes [--json]` — non-interactive execution for CI, scripts,
 * and automation. No TUI: capability requests are auto-approved for the session
 * and progress streams to stderr (stdout stays clean for --json output).
 *
 * Safety model: auto-approval is only available for a directory the user has
 * ALREADY trusted with `larb trust --full` — an explicit, prior, human decision.
 * The sandbox, spend caps, and deny-policy still apply in full; there is no
 * flag that bypasses those.
 */
export async function headlessRun(
  projectRoot: string,
  task: string,
  opts: HeadlessOptions,
): Promise<void> {
  const log = (line: string) => process.stderr.write(line + "\n");

  const trust = new TrustEngine();
  if (trust.status(projectRoot)?.scope !== "full") {
    console.error(
      "Headless mode (--yes) requires prior full trust for this directory.\n" +
        "Run `larb trust --full` here first (review what that grants before you do).",
    );
    process.exitCode = 1;
    return;
  }

  const approver: Approver = async () => "allow-session";
  const session = buildSession({
    projectRoot,
    mode: "run",
    approver,
    resume: opts.resume,
    callbacks: {
      onText: (delta) => process.stderr.write(delta),
      onToolStart: (name) => log(`\n→ ${name}`),
      onToolResult: (summary, ok) => log(`  ${ok ? "✓" : "✗"} ${summary}`),
      onVerify: (command, ok) => log(`  verify ${ok ? "✓" : "✗"} ${command}`),
      onNote: (note) => log(`· ${note}`),
    },
  });

  const iso = session.isolation;
  log(`larb headless · ${session.provider.label} · ${session.provider.orchestrator}`);
  log(`sandbox: ${iso.note}`);
  if (iso.reducedIsolation) {
    log("⚠ reduced isolation — commands run as a host subprocess (no container runtime).");
  }

  try {
    const result = await session.run(task);
    const summary = {
      task: opts.resume?.task ?? task,
      iterations: result.iterations,
      editsMade: result.editsMade,
      verified: result.verified,
      costUsd: Number(session.cost.snapshot().sessionUsd.toFixed(4)),
    };
    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      log("");
      console.log(
        `Done in ${summary.iterations} step(s) · edits: ${summary.editsMade ? "yes" : "none"} · ` +
          `verification: ${summary.verified} · cost: $${summary.costUsd}`,
      );
    }
    if (result.verified === "failed") process.exitCode = 1;
  } catch (err) {
    const message = (err as Error).message;
    if (opts.json) {
      console.log(JSON.stringify({ task, error: message }, null, 2));
    }
    console.error(`Run failed: ${message}`);
    process.exitCode = 1;
  }
}
