import { createInterface } from "node:readline";
import { TrustEngine, type Approver, type Decision } from "@larb/governors";
import type { RunMode } from "@larb/core";
import { buildSession } from "../wiring.js";

/**
 * Headless editor bridge (SPEC §7.11). Speaks a line-delimited JSON protocol over
 * stdio so an editor extension can drive the same governed agent the TUI uses —
 * no Ink, no terminal. Every event the TUI renders is emitted as one JSON line on
 * stdout; trust and permission decisions are requested on stdout and answered on
 * stdin. The trust-before-anything and per-capability approval guarantees are
 * unchanged — this is just a different interface onto the same `buildSession`.
 *
 * stdout events: { type: "provider"|"isolation"|"text"|"tool"|"tool-result"|
 *   "verify"|"cost"|"diff"|"note"|"trust-request"|"approval-request"|
 *   "summary"|"error"|"ready"|"done", ... }
 * stdin messages: { type: "run", mode, task } | { type: "trust", scope } |
 *   { type: "approval", decision }
 */
export function bridgeCommand(projectRoot: string): void {
  const rl = createInterface({ input: process.stdin });
  const emit = (event: Record<string, unknown>): void => {
    process.stdout.write(JSON.stringify(event) + "\n");
  };

  // One outstanding request for input at a time (trust or approval).
  let waiter: ((line: Record<string, unknown>) => void) | null = null;
  const nextInput = () => new Promise<Record<string, unknown>>((resolve) => (waiter = resolve));

  rl.on("line", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      emit({ type: "error", message: `invalid JSON: ${raw.slice(0, 200)}` });
      return;
    }
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(msg);
    } else if (msg.type === "run") {
      void drive(msg);
    }
  });

  const approver: Approver = async (request) => {
    emit({ type: "approval-request", request });
    const reply = await nextInput();
    return (reply.decision as Decision) ?? "deny";
  };

  async function drive(msg: Record<string, unknown>): Promise<void> {
    const mode = (msg.mode as RunMode) ?? "ask";
    const task = String(msg.task ?? "").trim();
    if (!task) {
      emit({ type: "error", message: "missing task" });
      return;
    }

    try {
      const trust = new TrustEngine();
      const status = trust.status(projectRoot);
      const enough = status && (mode === "run" ? status.scope === "full" : true);
      if (!enough) {
        emit({ type: "trust-request", projectRoot, need: mode === "run" ? "full" : "read-only" });
        const reply = await nextInput();
        const scope = reply.scope as "read-only" | "full" | undefined;
        if (scope !== "read-only" && scope !== "full") {
          emit({ type: "error", message: "trust denied" });
          emit({ type: "done" });
          return;
        }
        trust.trust(projectRoot, scope);
      }

      const session = buildSession({
        projectRoot,
        mode,
        approver,
        callbacks: {
          onText: (delta) => emit({ type: "text", delta }),
          onToolStart: (name, input) => emit({ type: "tool", name, input }),
          onToolResult: (summary, ok) => emit({ type: "tool-result", summary, ok }),
          onVerify: (command, ok) => emit({ type: "verify", command, ok }),
          onCost: (usd) => emit({ type: "cost", usd }),
          onDiff: (path, diff) => emit({ type: "diff", path, diff }),
          onNote: (note) => emit({ type: "note", note }),
        },
      });

      emit({ type: "provider", ...session.provider });
      emit({ type: "isolation", ...session.isolation });

      const result = await session.run(task);
      emit({ type: "summary", ...result });
      emit({ type: "done" });
    } catch (err) {
      emit({ type: "error", message: (err as Error).message });
      emit({ type: "done" });
    }
  }

  emit({ type: "ready", projectRoot });
}
