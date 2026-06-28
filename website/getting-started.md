# Getting started

> ⚠️ **Status: `0.1.0-alpha`.** Early, bring-your-own-key developers only. APIs
> and config may change. Larb runs **autonomously** and executes commands on
> your machine — skim the [security model](/security) before relying on it.

## 1. Install

Larb needs **Node.js ≥ 20**. During the alpha it's published under the `alpha`
tag, so install with `@alpha`:

```bash
npm i -g @larb/cli@alpha
larb version
```

## 2. Choose a model (bring your own key)

Larb is model-agnostic — no provider is privileged. Pick one with `kind` in
`~/.larb/config.toml` and export that provider's API key. You own your keys
(read from the environment, never from repo config) and your routing.

```toml
# ~/.larb/config.toml
[provider]
kind = "openai"      # anthropic · openai · ollama · deepseek · gemini · groq ·
                     # mistral · xai · openrouter · together · perplexity

[provider.models]    # optional — omit to use the provider's defaults
orchestrator = "gpt-4o"        # strong model: plans & drives the loop
worker       = "gpt-4o-mini"   # cheap/fast model: subtasks & compaction
```

```bash
export OPENAI_API_KEY=sk-...    # the env var for your chosen provider
larb providers                  # list providers + which keys are set
```

**Prefer free / local?** Set `kind = "ollama"` and run a local model — no key,
no spend:

```toml
[provider]
kind = "ollama"
[provider.models]
orchestrator = "llama3.1"
```

## 3. Your first run

`larb ask` is **read-only** — a safe way to confirm everything works:

```bash
larb ask "What does this project do?"
```

`larb run` makes changes. The first time you point Larb at a directory it asks
for a **trust decision** (nothing is read-as-code or sent over the network
before you decide). Then every file write shows a diff and every command asks
for approval:

```bash
larb run "Add a --version flag to the CLI"
```

A `run` isn't "done" until your configured verification commands pass:

```toml
verify = ["npm run -s typecheck", "npm test"]
```

## 4. What to understand before relying on it

Larb is **security-first** — these are on by default:

- **Trust before anything** — no executable config is read and no network call
  is made until you make a trust decision for a directory.
- **Capability permissions** — writes, commands, network, and MCP calls are each
  approved (once / session / always / deny) and **every grant is logged**. See
  `larb audit`.
- **Hard spend caps** — live token/$ accounting halts the agent before it
  overspends. Tune them under `[limits]`.
- **Real sandboxed execution** — commands run in a rootless container
  (docker/podman) with host secrets withheld and networking off by default; if
  no runtime is present it falls back to a reduced-isolation host subprocess and
  tells you which is active at the start of every run.

Read the full **[security model](/security)** before unattended use.

## 5. Going further

- **Project instructions** — drop an `AGENTS.md` in your repo to tell Larb your
  build/test commands and conventions (advisory; it can't override permissions).
- **External tools (MCP)** — add `[[mcp]]` servers in your global config and
  inspect them with `larb mcp` / `larb mcp probe`. See the
  [architecture](/architecture#mcp-external-tools).
- **Skills** — install governed, signed extensions: `larb skill <cmd>`.
- **Durable runs** — `larb runs` lists snapshots; `larb resume` continues an
  interrupted one.

## Next

- [Architecture](/architecture) — how the orchestrator, providers, sandbox, and
  governors fit together.
- [Security model](/security) — the attack classes Larb designs out.
- [Comparison](/comparison) · [Roadmap](/roadmap)
