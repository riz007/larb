# Larb — Resolved design decisions

This records the SPEC §15 "open decisions" that the implementation now answers,
so the spec stays the source of truth and contributors know what is settled.
Each entry: the decision, the rationale, and where it lives in the code.

## D1. Surface scope for v1 — **CLI + TUI**
Both ship today. The CLI dispatches commands (`packages/cli/src/index.ts`) and
the interactive surface is an Ink TUI (`packages/cli/src/tui/app.tsx`) with
streaming output, diff review, layered approval prompts, and a live cost meter.
A post-MVP **editor bridge** is now also available as a headless JSON protocol
(`larb bridge`, `packages/cli/src/commands/bridge.ts`) so editors can drive the
same agent without the TUI.

## D2. Runtime — **Node.js (LTS), Bun/Deno deferred**
Node ≥ 20 (`package.json` `engines`). It is the pragmatic default and matches the
npm-based skill-ecosystem story. Bun (single-binary) and Deno (built-in permission
sandbox) remain worth a spike but are not required: isolation is delivered by the
container backend (D3), not the JS runtime.

## D3. Sandbox baseline — **container + spawn fallback (auto)**
Command execution runs through a pluggable backend
(`packages/sandbox/`): a rootless **ContainerBackend** (docker/podman, project-only
bind mount, host secrets withheld, `--network none` by default) when a runtime is
available, falling back to a reduced-isolation **SpawnBackend** otherwise. The
selection is `auto` by default and configurable via the trusted-only `[sandbox]`
config; an explicit `backend = "container"` refuses to silently downgrade. A
microVM option is a future backend behind the same `SandboxBackend` seam.

## D4. Bundled default model — **user chooses; Anthropic preset is the default kind**
No model is privileged in code. `kind` selects a provider preset
(`packages/providers/src/presets.ts`); the default kind is `anthropic`, but the
key must be present in the environment or Larb errors with guidance. Keys are read
from env only, never repo config.

## D5. Plugin/skill isolation mechanism — **child process (`fork`)**
Skill plugins run in an isolated child process via the capability broker
(`packages/skills/src/broker.ts`), which strips host env and brokers every
fs/exec/net request against both the skill manifest and the permission engine.
WASM remains a possible future tier; the broker boundary does not change.

## D6. Network egress — **default-deny, governed via the `net` capability**
The agent's one in-process network path is the `http_fetch` tool
(`packages/core/src/tools/http.ts`), gated per-host by the `net` capability
(default-deny, every host approved + audited). Under the container backend, shell
commands get no network (`--network none`) by default; in `allowlist` mode,
container egress is routed through a host-side `EgressProxy`
(`packages/sandbox/src/egress.ts`) that permits only the configured `egressAllow`
hosts (default-deny), filtering proxy-respecting clients such as package managers
and curl. Airtight raw-socket blocking is a future microVM/internal-network
backend behind the same seam.
