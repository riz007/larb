# Changelog

All notable changes to Larb are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

## [0.1.0-alpha.1] — 2026-06-04

First tagged alpha. **Pre-release software for early, BYO-key developers** — APIs,
config, and the skill format may change without notice. Not yet recommended for
unattended or production use. See "Known limitations" in the README.

### Added

- **Trust-before-anything boot** — no executable config is read and no network
  call is made before a per-directory trust decision.
- **Capability-gated tools** + a layered permission engine (allow once / for the
  session / always / deny) with a project policy file.
- **Append-only audit log** of every model call, tool call, and permission grant.
- **Hard spend governor** — live token/$ accounting with limits that halt the
  agent (per run / session / day).
- **Model-agnostic providers** — Anthropic, OpenAI, Ollama, DeepSeek, Gemini,
  Groq, Mistral, xAI, OpenRouter, Together, Perplexity — selected by one config
  line; keys read only from the environment. Provider conformance suite.
- **Agent orchestration loop** with a mandatory verification step (lint/build/
  test) and multi-agent delegation to a cheaper worker model.
- **Real incremental streaming** for the OpenAI (SSE) and Ollama (NDJSON)
  adapters; **Anthropic prompt caching** with cache-aware cost accounting.
- **Pluggable execution sandbox** — rootless container (docker/podman) backend
  with project-only mount, host secrets withheld, and `--network none` by
  default; reduced-isolation host-subprocess fallback that reports itself.
- **Governed network egress** — an `http_fetch` tool gated per-host by the `net`
  capability, plus a host egress proxy enforcing the container allow-list.
- **Durable run state** — `larb runs` / `larb resume` to continue interrupted
  runs.
- **Governed skills** — SKILL.md + signed/manifested plugins, installable from a
  directory, an https tarball, or a git URL (install ≠ trust).
- **Secrets broker** — a single redacting boundary for API keys.
- **Benchmark harness** — `larb bench` (resolution rate + cost/task) with
  per-task git-worktree isolation and a SWE-bench-style loader/grader.
- **Interfaces** — CLI, an Ink TUI (streaming, diff review, approval prompts,
  live cost meter), and a headless `larb bridge` stdio JSON protocol for editors.
- Build pipeline producing a single executable CLI bundle; CI (typecheck, test,
  build, smoke-test).

### Known gaps (tracked for the next releases)

- No confirmed large-scale live run yet; the container sandbox needs live
  verification on a host with a runtime (see `docs/verify-container.md`).
- Container egress allow-listing filters proxy-respecting clients only;
  airtight raw-socket blocking awaits a microVM backend.
- SWE-bench grading ships as primitives + loader; full graded runs need the
  dataset repos and per-repo test commands (see `docs/swebench.md`).

[Unreleased]: https://github.com/riz007/larb/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/riz007/larb/releases/tag/v0.1.0-alpha.1
