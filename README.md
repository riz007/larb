# Larb

![Larb Code banner](./assets/larb-code.png)

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
- **Model-agnostic provider abstraction** — point Larb at Anthropic, OpenAI,
  DeepSeek, Gemini, Groq, Mistral, xAI (Grok), OpenRouter, Together, Perplexity,
  or a local Ollama model by changing one line of config. See
  [Providers](#providers) below.
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

## License

Apache-2.0. Contributions require signing the [CLA](./CLA.md). See
[`SECURITY.md`](./SECURITY.md) for coordinated disclosure and
[`threat-model.md`](./threat-model.md) for the attack classes Larb designs out.
