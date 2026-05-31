#!/usr/bin/env node
import { runInteractive } from "./tui/app.js";
import { auditCommand } from "./commands/audit.js";
import { trustCommand } from "./commands/trust.js";

const VERSION = "0.1.0";

const HELP = `Larb — open-source, model-agnostic, security-first coding agent

Usage:
  larb ask <question>     Answer a question about this repo (read-only)
  larb run <task>         Autonomously complete a task (prompts for writes/exec)
  larb trust [flags]      Show or set trust for this directory
                          flags: --full | --read-only | --revoke
  larb audit              Show the audit log + cost summary for this project
  larb help               Show this help
  larb version            Show version

Larb makes ZERO network calls and reads ZERO executable config before you make
a trust decision for a directory. Set ANTHROPIC_API_KEY to use the agent.
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
