# Architecture

Larb is a TypeScript monorepo (pnpm workspaces). Every component is a spec-able
module behind a clean interface, so no model, provider, or sandbox technology is
privileged in the codebase.

## High-level overview

The interface layer talks to an **orchestrator** that drives a plan → act →
observe → verify loop. The orchestrator draws on four subsystems and is wrapped
by **cross-cutting governors** that enforce trust, permissions, spend, and audit
on every action.

```mermaid
flowchart TD
    U([User]) --> IF["Interface layer<br/>CLI · TUI · editor bridge"]
    IF --> ORCH["Agent Orchestrator<br/>plan → act → observe → verify"]

    ORCH --> MP["Model Provider<br/>Abstraction"]
    ORCH --> TL["Tool / Capability<br/>Layer + exec sandbox"]
    ORCH --> CE["Context Engine<br/>repo map · memory · AGENTS.md · compaction"]
    ORCH --> SK["Skill / Plugin<br/>Registry (signed)"]
    ORCH --> MC["MCP servers<br/>external tools (gated)"]

    subgraph GOV["Cross-cutting governors"]
      direction LR
      TR["Trust engine"]
      PE["Permission engine"]
      CG["Cost / spend governor"]
      AL["Audit log"]
    end

    MP -.enforced by.-> GOV
    TL -.enforced by.-> GOV
    CE -.enforced by.-> GOV
    SK -.enforced by.-> GOV
    MC -.enforced by.-> GOV

    MP --> PR{{"Anthropic · OpenAI ·<br/>Ollama · 8 more"}}
    TL --> SB[["Sandbox backend<br/>container / spawn"]]
```

## The agent loop

A `run` is not "done" until the project's verification commands pass (or the
iteration budget is exhausted). The loop persists a durable snapshot every
iteration, so an interrupted run can be resumed exactly where it stopped.

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant M as Model provider
    participant P as Permission engine
    participant S as Sandbox
    participant V as Verify loop

    O->>M: stream(system + messages + tools)
    M-->>O: text deltas + tool calls
    loop each tool call
        O->>P: require(capability, path/host)
        P-->>O: allow / deny (prompt if needed)
        O->>S: execute (cwd-scoped, secrets stripped)
        S-->>O: result (guarded vs injection)
    end
    O->>M: feed tool results back
    Note over O,M: repeat until the model stops calling tools
    O->>V: run lint / build / tests
    V-->>O: pass ✓ / fail ✗ (+ report)
    alt verification failed
        O->>M: "fix the issues, then continue"
    else passed
        O-->>O: done — record final snapshot
    end
```

**Multi-agent mode.** A strong _orchestrator_ model can delegate scoped subtasks
to a cheaper _worker_ model (the DeepSeek Pro/Flash pattern, generalized across
providers). Workers share the permission engine and cost governor and get no
delegate tool of their own, which bounds recursion.

## Trust & permission flow

This is the headline security behaviour. On opening a directory, Larb reads
**zero** executable config and makes **zero** network calls until you decide.
Thereafter every capability use is checked, layered, and logged.

```mermaid
flowchart TD
    A([Open a directory]) --> B{Trusted?}
    B -- no --> C["Prompt: read-only / full / deny<br/>(no config read, no network yet)"]
    C -->|deny| Z([Stop — nothing happened])
    C -->|trust| D[Build governed session]
    B -- yes --> D
    D --> E{{Capability request}}
    E --> F{deny policy?}
    F -- match --> X([Denied])
    F -- no --> G{allow policy / grant?}
    G -- yes --> Y([Allowed · logged])
    G -- no --> H[Ask: once / session / always / deny]
    H --> Y
    H --> X
```

Repo-level config can _propose_ models, verification commands, and lower spend
limits — but it can **never** set the API base URL, choose the key env var, add
allow-rules, raise limits, weaken sandbox isolation, or trigger execution.

## Model provider abstraction

A thin interface — `generate`, `stream`, `countTokens`, `estimateCost` — with
adapters for the Anthropic Messages API, OpenAI Chat Completions, and a local
Ollama adapter. Most providers expose an OpenAI-compatible API, so they share a
single audited adapter; adding one is a new row in a preset table, not new code.

```mermaid
flowchart LR
    CFG["config.toml<br/>kind = …"] --> R[ProviderRouter]
    R --> SBK[[Secret broker<br/>reads key from env, redacts everywhere]]
    R -->|transport| AN[Anthropic Messages]
    R -->|transport| OA[OpenAI Chat Completions]
    R -->|transport| OL[Ollama local]
    OA --- DS[DeepSeek]
    OA --- GE[Gemini]
    OA --- GR[Groq]
    OA --- MI[Mistral]
    OA --- XA[xAI]
    OA --- OR[OpenRouter]
    OA --- TO[Together]
    OA --- PE[Perplexity]
```

Routing is declarative policy, not hardcoded: **orchestration → strong model**,
**subagents / compaction → cheap, fast model**, **offline → local**. The API key
is read once by the secret broker and handed only to the adapter — the agent
loop and tools never see it.

## Execution sandbox

Command execution runs through a **pluggable backend** behind one interface.

```mermaid
flowchart TD
    RUN([Command to run]) --> SEL{backend policy}
    SEL -->|auto + runtime found| C[ContainerBackend]
    SEL -->|auto, no runtime| S[SpawnBackend]
    SEL -->|container, none| ERR([Error: won't silently downgrade])
    C --> CI["rootless docker/podman<br/>project-only mount · no host secrets<br/>--network none by default"]
    C -->|network = allowlist| PX[Host egress proxy<br/>per-host default-deny]
    S --> SI["host subprocess<br/>cwd-scoped · secrets stripped<br/>⚠ reduced isolation"]
```

The active isolation level is printed at the start of every run, so the trust
decision stays informed. The container backend is the SPEC's Codex-parity
isolation primitive; a microVM backend can slot in behind the same seam later.

## Context engine

- **Repo map** — an incremental structural index for cross-file reasoning.
- **Memory** — local, inspectable markdown on disk, per-project scope.
- **Project instructions (`AGENTS.md`)** — `AGENTS.md` and `.larb/AGENTS.md` are
  loaded as advisory system-prompt context (size-bounded). They shape how the
  agent approaches the task but can never override the safety principles or the
  permission engine.
- **Compaction** — proactive summarization with the cheap worker model so long
  sessions stay cheap and don't overflow the context window.
- **Injection guard** — untrusted tool/repo output is screened for injected
  instructions before it re-enters the model context.

## Skill & plugin registry

```mermaid
flowchart LR
    SRC[["dir · https tarball · git URL"]] --> INST[Install<br/>copy + validate manifest]
    INST --> TIER{Signature?}
    TIER -->|maintainer key| FP[first-party]
    TIER -->|trusted key| VF[verified]
    TIER -->|unsigned/tampered| CM["community<br/>tightest sandbox + consent"]
    FP & VF & CM --> RUN["Run in isolated child process<br/>broker enforces the manifest"]
```

Every skill ships a **manifest** declaring exactly the capabilities it needs (fs
paths, network hosts, exec, secrets). The broker enforces that manifest against
both the declaration and the permission engine — **install ≠ trust**.

## MCP (external tools)

Larb speaks the **Model Context Protocol**, so you can plug in external tool
servers (filesystem, GitHub, databases, or your own) and the agent uses them
like any built-in tool.

```mermaid
flowchart LR
    CFG["~/.larb/config.toml<br/>[[mcp]] (trusted-global only)"] --> MGR[MCP manager]
    MGR -->|stdio JSON-RPC| SRV[["MCP server<br/>(spawned in a run)"]]
    SRV --> TOOLS["tools/list → tools/call"]
    TOOLS --> GATE{Permission engine<br/>mcp capability}
    GATE -->|allow · logged| ORCH2[Orchestrator loop]
    GATE -->|deny| X([Denied])
```

- Each remote tool is surfaced as `mcp__<server>__<tool>` and is **permission-
  gated** by an `mcp` capability scoped to the server; every call is audited and
  its output passes through the injection guard.
- `[[mcp]]` config is **trusted-global-only** — a stdio server spawns a command,
  so an untrusted repo can never define one. Servers connect only **inside a
  run** (after a trust decision) and are torn down when it ends.
- Inspect configured servers with `larb mcp`, or connect and list their tools
  with `larb mcp probe`.

## Repository layout

```
packages/
  governors/   trust · permission · cost · audit · secret broker
  providers/   model adapters · routing · conformance suite
  sandbox/     pluggable execution isolation · egress proxy
  context/     repo map · markdown memory · AGENTS.md · compaction
  core/        orchestrator loop · tools · run state · bench · worktrees
  skills/      skill + plugin runtime · manifest · signing · broker
  mcp/         Model Context Protocol client · stdio transport · tool broker
  cli/         CLI · Ink TUI · editor bridge
skills-sdk/    TypeScript SDK for community skills
```

Continue to the **[comparison](/comparison)** or the **[security model](/security)**.
