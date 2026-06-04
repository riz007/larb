#!/usr/bin/env node
import { runInteractive } from "./tui/app.js";
import { auditCommand } from "./commands/audit.js";
import { trustCommand } from "./commands/trust.js";
import { skillCommand } from "./commands/skill.js";
import { providersCommand } from "./commands/providers.js";
import { bridgeCommand } from "./commands/bridge.js";

const VERSION = "0.1.0";

const HELP = `Larb — open-source, model-agnostic, security-first coding agent

Usage:
  larb ask <question>     Answer a question about this repo (read-only)
  larb run <task>         Autonomously complete a task (prompts for writes/exec)
  larb trust [flags]      Show or set trust for this directory
                          flags: --full | --read-only | --revoke
  larb skill <cmd>        Manage skills (list/init/install/verify/sign/keygen)
  larb providers [name]   List model providers (or show one's details)
  larb bridge             Drive the agent over a stdio JSON protocol (for editors)
  larb audit              Show the audit log + cost summary for this project
  larb help               Show this help
  larb version            Show version

Larb makes ZERO network calls and reads ZERO executable config before you make
a trust decision for a directory. Larb is model-agnostic: pick any provider with
'kind' in ~/.larb/config.toml (run 'larb providers') and set its API key env var.
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
      const task = rest.join(" ").trim();
      if (!task) return fail("Usage: larb run <task>");
      runInteractive({ mode: "run", task, projectRoot: cwd });
      return;
    }
    case "trust":
      return trustCommand(cwd, rest);
    case "skill":
      return skillCommand(cwd, rest);
    case "providers":
      return providersCommand(rest);
    case "bridge":
      return bridgeCommand(cwd);
    case "audit":
      return auditCommand(cwd);
    case "version":
    case "--version":
    case "-v":
      console.log(`larb ${VERSION}`);
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

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

main();
