#!/usr/bin/env node
import { runInteractive } from "./tui/app.js";
import { auditCommand } from "./commands/audit.js";
import { trustCommand } from "./commands/trust.js";
import { skillCommand } from "./commands/skill.js";
import { providersCommand } from "./commands/providers.js";
import { mcpCommand } from "./commands/mcp.js";
import { headlessRun } from "./commands/headless.js";
import { bridgeCommand } from "./commands/bridge.js";
import { runsCommand } from "./commands/runs.js";
import { benchCommand } from "./commands/bench.js";
import { RunStateStore } from "@larb/core";

const VERSION = "0.1.0-alpha.3";

const HELP = `Larb — open-source, model-agnostic, security-first coding agent

Usage:
  larb ask <question>     Answer a question about this repo (read-only)
  larb run <task>         Autonomously complete a task (prompts for writes/exec)
                          flags: --yes (headless: no prompts; needs prior
                          \`larb trust --full\`) · --json (machine-readable result)
  larb runs               List run snapshots (resumable ones are marked)
  larb resume [id]        Resume an interrupted run (latest if no id given;
                          supports --yes/--json)
  larb trust [flags]      Show or set trust for this directory
                          flags: --full | --read-only | --revoke
  larb skill <cmd>        Manage skills (list/init/install/verify/sign/keygen)
  larb providers [name]   List model providers (or show one's details)
  larb mcp [probe]        List configured MCP servers (or probe them for tools)
  larb bridge             Drive the agent over a stdio JSON protocol (for editors)
  larb bench <suite>      Run a task suite (or --swebench <jsonl>); report cost/task
  larb audit              Show the audit log + cost summary for this project
  larb help               Show this help
  larb version            Show version

Larb makes ZERO network calls and reads ZERO executable config before you make
a trust decision for a directory. Larb is model-agnostic: pick any provider with
'kind' in ~/.larb/config.toml (run 'larb providers') and set its API key env var.

Docs: https://riz007.github.io/larb/  (new here? read getting-started + security first)
`;

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();

  switch (command) {
    case "ask": {
      const task = rest.join(" ").trim();
      if (!task) return fail("Usage: larb ask <question>");
      runInteractive({ mode: "ask", task, projectRoot: cwd });
      return;
    }
    case "run": {
      const { flags, positional } = splitFlags(rest);
      const task = positional.join(" ").trim();
      if (!task) return fail("Usage: larb run <task> [--yes] [--json]");
      if (flags.has("--json") && !flags.has("--yes")) {
        return fail("--json requires --yes (headless mode).");
      }
      if (flags.has("--yes")) {
        void headlessRun(cwd, task, { json: flags.has("--json") });
        return;
      }
      runInteractive({ mode: "run", task, projectRoot: cwd });
      return;
    }
    case "runs":
      return runsCommand(cwd);
    case "resume": {
      const { flags, positional } = splitFlags(rest);
      const store = new RunStateStore(cwd);
      const id = positional[0];
      const state = id ? store.load(id) : store.latest(true);
      if (!state) {
        return fail(
          id ? `No run found with id "${id}".` : "No resumable run found. See `larb runs`.",
        );
      }
      if (flags.has("--yes")) {
        void headlessRun(cwd, state.task, { json: flags.has("--json"), resume: state });
        return;
      }
      runInteractive({ mode: "run", task: state.task, projectRoot: cwd, resume: state });
      return;
    }
    case "trust":
      return trustCommand(cwd, rest);
    case "skill":
      return skillCommand(cwd, rest);
    case "providers":
      return providersCommand(rest);
    case "mcp":
      return mcpCommand(cwd, rest);
    case "bridge":
      return bridgeCommand(cwd);
    case "bench":
      return benchCommand(cwd, rest);
    case "audit":
      return auditCommand(cwd);
    case "version":
    case "--version":
    case "-v":
      console.log(`larb ${VERSION}`);
      console.log("docs: https://riz007.github.io/larb/");
      return;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      return fail(`Unknown command: ${command}\n\n${HELP}`);
  }
}

function splitFlags(args: string[]): { flags: Set<string>; positional: string[] } {
  const flags = new Set<string>();
  const positional: string[] = [];
  for (const a of args) {
    if (a === "--yes" || a === "--json") flags.add(a);
    else positional.push(a);
  }
  return { flags, positional };
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

main();
