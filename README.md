# Larb

![Larb Code banner](./assets/larb-code.png)

> Open-source, model-agnostic, security-first autonomous coding agent.

### 📖 Documentation → **https://riz007.github.io/larb/**

New here? Start with **[Getting started](https://riz007.github.io/larb/getting-started)**
and the **[Security model](https://riz007.github.io/larb/security)** before your
first run — Larb runs autonomously and executes commands on your machine.

Larb is a terminal-native autonomous engineer you can point at any model,
extend with governed skills, and run without rate-limit cliffs or vendor
lock-in — with a trust model that makes opening an untrusted repo safe by
default.

> ⚠️ **Status: `0.1.0-alpha` — early, BYO-key developers only.** APIs, config,
> and the skill format may change without notice. Review a run's actions rather
> than leaving it fully unattended, and read **[Known limitations](#known-limitations)**
> before relying on it. Feedback and issues very welcome.

## What's implemented today

- **Trust-before-anything boot** — no executable config is read and no network
  call is made before you make a trust decision for a directory.
- **Capability-gated tools** with a fine-grained permission engine
  (allow once / for the session / always / deny).
- **Append-only audit log** of every model call, tool call, and grant.
- **Hard spend governor** — live token/$ accounting with limits that *halt* the
  agent rather than just warn.
- **Model-agnostic provider abstraction** — point Larb at Anthropic, OpenAI,
  DeepSeek, Gemini, Groq, Mistral, xAI (Grok), OpenRouter, Together, Perplexity,
  or a local Ollama model by changing one line of config. See
  [Providers](#providers) below.
- **Agent orchestration loop** — plan → act → observe → verify, with a
  mandatory verification step (lint/build/test) before a task is "done".
- **Real sandboxed execution** — commands run in a rootless container
  (docker/podman) with the project bind-mounted, host secrets withheld, and
  networking off by default; falls back to a reduced-isolation host subprocess
  when no runtime is present, and tells you which is active.
- **Governed network egress** — the agent's only in-process network path is an
  `http_fetch` tool gated per-host by the `net` capability (default-deny, every
  host approved and audited); in container `allowlist` mode, command egress is
  routed through a host proxy that permits only allow-listed hosts.
- **Durable run state** — every run is snapshotted; `larb runs` lists them and
  `larb resume` continues an interrupted one exactly where it stopped.
- **Incremental repo map** + inspectable markdown memory.
- **Governed skills, installable from a directory, an https tarball, or a git
  URL** — signed/manifested, with install ≠ trust (unsigned ⇒ tightest sandbox).
- **MCP (Model Context Protocol) servers** — plug in external tools (filesystem,
  GitHub, custom company servers) via `[[mcp]]` in your global config. Each
  remote tool is a permission-gated, audited tool (`mcp__<server>__<tool>`);
  servers connect only inside a run, after trust. Inspect them with
  `larb mcp` / `larb mcp probe`.
- **`AGENTS.md` project instructions** — Larb reads `AGENTS.md` (and
  `.larb/AGENTS.md`) and injects it as advisory guidance, so a repo can describe
  its build/test commands and conventions. It shapes the agent's approach but
  never overrides the safety principles or the permission engine.
- **Benchmark harness** — `larb bench <suite>` reports resolution rate and
  cost-per-task (the §14 metrics).
- **CLI, TUI, and a headless editor bridge** (`larb bridge`, a stdio JSON
  protocol) — true incremental streaming, diff review, approval prompts, live
  cost meter.

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

Requires **Node.js ≥ 20** and **pnpm**.

```bash
pnpm install
pnpm build                 # bundles the CLI to packages/cli/dist/index.js
export ANTHROPIC_API_KEY=sk-ant-...   # or any provider key (see Providers)

# Run from the repo:
pnpm larb ask "What does the orchestrator loop do?"   # read-only
pnpm larb run "Add a --version flag to the CLI"       # prompts for trust + each write/exec
pnpm larb audit                                        # audit log + cost
```

### Install the `larb` command globally

```bash
pnpm build
npm link ./packages/cli    # puts `larb` on your PATH (resolves deps from this checkout)
larb version
```

A published `npm i -g @larb/cli` is planned but not yet available — use `npm link`
for now.

See [`config.example.toml`](./config.example.toml) for configuration.

## Providers

Larb is model-agnostic. No provider is privileged in the codebase — each one is
a row in a preset table that bundles its wire transport, base URL, key env var,
default models, and pricing. You own your keys (read from the environment, never
from repo config) and your routing.

Select a provider with `kind` in `~/.larb/config.toml` and export its API key:

```toml
[provider]
kind = "deepseek"        # see the table below
# apiKeyEnv = "..."       # override the key env var (optional)
# baseURL   = "..."       # point at any compatible endpoint (trusted config only)

[provider.models]         # optional — omit to use the preset's defaults
orchestrator = "deepseek-chat"   # strong model: plans & orchestrates
worker       = "deepseek-chat"   # cheap/fast model: subtasks & compaction
```

```bash
export DEEPSEEK_API_KEY=...
```

| `kind`        | Provider         | API key env var       | Transport          |
|---------------|------------------|-----------------------|--------------------|
| `anthropic`   | Anthropic Claude | `ANTHROPIC_API_KEY`   | Anthropic Messages |
| `openai`      | OpenAI GPT       | `OPENAI_API_KEY`      | OpenAI Chat        |
| `ollama`      | Local (Ollama)   | — (no key, no spend)  | Ollama             |
| `deepseek`    | DeepSeek         | `DEEPSEEK_API_KEY`    | OpenAI-compatible  |
| `gemini`      | Google Gemini    | `GEMINI_API_KEY`      | OpenAI-compatible  |
| `groq`        | Groq             | `GROQ_API_KEY`        | OpenAI-compatible  |
| `mistral`     | Mistral          | `MISTRAL_API_KEY`     | OpenAI-compatible  |
| `xai`         | xAI Grok         | `XAI_API_KEY`         | OpenAI-compatible  |
| `openrouter`  | OpenRouter       | `OPENROUTER_API_KEY`  | OpenAI-compatible  |
| `together`    | Together AI      | `TOGETHER_API_KEY`    | OpenAI-compatible  |
| `perplexity`  | Perplexity       | `PERPLEXITY_API_KEY`  | OpenAI-compatible  |

Most providers expose an OpenAI-compatible Chat Completions API, so they share a
single audited adapter — adding a new one is a new table row, not new code. For
any endpoint not listed, set `kind = "openai"` (or `"anthropic"`) and override
`baseURL` + `apiKeyEnv`.

**Routing.** The strong `orchestrator` model plans and drives the loop; a cheap
`worker` model handles delegated subtasks and context compaction, so long runs
stay inexpensive. Both are per-provider and overridable.

List providers and check which keys are set from the CLI:

```bash
larb providers            # table of all providers + whether each key is set
larb providers deepseek   # base URL, default models, and config snippet
```

## Known limitations

This is an alpha. Be aware of these before relying on it:

- **Sandbox isolation depends on a container runtime.** Real isolation (the
  "safe to open an untrusted repo" property) needs **docker** or **podman**
  installed. Without one, Larb falls back to a **reduced-isolation host
  subprocess** — cwd-scoped with host secrets stripped, but the host filesystem
  and network are reachable. The active level is printed at the start of every
  run; verify the container path with [`docs/verify-container.md`](./docs/verify-container.md).
- **Container egress allow-listing** filters proxy-respecting clients (package
  managers, curl, fetch); airtight raw-socket blocking awaits a microVM backend.
- **SWE-bench** ships as a loader + grading primitives; full graded runs need the
  dataset repos and per-repo test commands ([`docs/swebench.md`](./docs/swebench.md)).
- **The editor bridge** (`larb bridge`) is a minimal stdio protocol, not yet a
  packaged editor extension.
- **MCP support is stdio-only** for now (the common case); SSE/HTTP transports
  and MCP resources/prompts are planned behind the same client interface. MCP
  servers are **global-config-only** — a repo can never define one.
- **`larb bench`** runs tasks autonomously with auto-approval — point it at a
  disposable checkout only.
- Prompt caching and streaming are covered by tests against mocked transports;
  confirm savings/behavior against your live provider.

## License

Apache-2.0. Contributions require signing the [CLA](./CLA.md). The **"Larb" name
and logo** are trademarks and are not granted by the code license — see
[`TRADEMARK.md`](./TRADEMARK.md). See [`SECURITY.md`](./SECURITY.md) for
coordinated disclosure, [`CHANGELOG.md`](./CHANGELOG.md) for release notes, and
[`threat-model.md`](./threat-model.md) for the attack classes Larb designs out.
