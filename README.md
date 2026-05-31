# Larb

> Open-source, model-agnostic, security-first autonomous coding agent.

Larb is a terminal-native autonomous engineer you can point at any model,
extend with governed skills, and run without rate-limit cliffs or vendor
lock-in — with a trust model that makes opening an untrusted repo safe by
default.

## What's implemented today

- **Trust-before-anything boot** — no executable config is read and no network
  call is made before you make a trust decision for a directory.
- **Capability-gated tools** with a fine-grained permission engine
  (allow once / for the session / always / deny).
- **Append-only audit log** of every model call, tool call, and grant.
- **Hard spend governor** — live token/$ accounting with limits that *halt* the
  agent rather than just warn.
- **Model provider abstraction** with an Anthropic adapter (the same adapter
  serves any Anthropic-compatible endpoint).
- **Agent orchestration loop** — plan → act → observe → verify, with a
  mandatory verification step (lint/build/test) before a task is "done".
- **Sandboxed command execution** — cwd-scoped, host secrets stripped.
- **Incremental repo map** + inspectable markdown memory.
- **CLI + minimal TUI** with streaming output, diff review, approval prompts,
  and a live cost meter.

## Repository layout

```
packages/
  governors/   trust · permission · cost · audit
  providers/   model provider abstraction + adapters
  sandbox/     scoped command execution
  context/     repo map + markdown memory
  core/        orchestrator loop + capability tools
  cli/         CLI + TUI
```

## Quick start

```bash
pnpm install
export ANTHROPIC_API_KEY=sk-ant-...

# Ask a question about a repo (read-only)
pnpm larb ask "What does the orchestrator loop do?"

# Run an autonomous task (prompts for trust + each write/exec)
pnpm larb run "Add a --version flag to the CLI"

# Inspect the audit log and cost
pnpm larb audit
```

See [`config.example.toml`](./config.example.toml) for configuration.

## License

Apache-2.0. Contributions require signing the [CLA](./CLA.md). See
[`SECURITY.md`](./SECURITY.md) for coordinated disclosure and
[`threat-model.md`](./threat-model.md) for the attack classes Larb designs out.
