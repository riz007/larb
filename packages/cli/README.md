# Larb

> Open-source, model-agnostic, security-first autonomous coding agent — for your terminal.

Larb is a terminal-native autonomous engineer you can point at **any** model
(Anthropic, OpenAI, DeepSeek, Gemini, Groq, Mistral, xAI, OpenRouter, Together,
Perplexity, or a local **Ollama** model), extend with governed skills, and run
without vendor lock-in — with a trust model that makes opening an untrusted repo
safe by default.

> ⚠️ **Status: `0.1.0-alpha` — early, bring-your-own-key developers only.** APIs,
> config, and the skill format may change. Review a run's actions rather than
> leaving it fully unattended.

## Install

```bash
npm i -g @larb/cli
larb version
```

Requires **Node.js ≥ 20**.

## Quick start

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # or any provider key (or none, for Ollama)

larb ask "What does the orchestrator loop do?"   # read-only
larb run "Add a --version flag to the CLI"       # prompts for trust + each write/exec
larb providers                                    # list providers + which keys are set
larb audit                                         # audit log + cost summary
```

Point Larb at any model by setting `kind` in `~/.larb/config.toml`:

```toml
[provider]
kind = "ollama"   # local, no key, no spend — or anthropic / openai / deepseek / ...
```

## Why Larb

- **Trust-before-anything boot** — no executable config read, no network call
  before you make a trust decision for a directory.
- **Capability-gated tools** with a fine-grained permission engine and an
  append-only **audit log** of every model call, tool call, and grant.
- **Hard spend governor** — live token/$ accounting that *halts* the agent.
- **Real sandboxed execution** in a rootless container (docker/podman), host
  secrets withheld, networking off by default.
- **Durable run state** — `larb runs` / `larb resume` continue interrupted runs.
- **Governed skills** — signed, manifested, installable from a dir, tarball, or
  git URL (install ≠ trust).

## Documentation

Full docs, provider table, security/threat model, and roadmap:
**https://github.com/riz007/larb**

## License

Apache-2.0. The **"Larb" name and logo** are trademarks and are not granted by
the code license. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
