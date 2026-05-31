# Larb Threat Model

> Status: draft. This document is the design-level rationale for Larb's security posture. It enumerates what we protect, who we defend against, and the specific attack classes we engineer out — each of which maps to a documented failure in an existing coding agent. Keep this in sync with the code; every security-relevant PR should be checkable against it.

## 1. Why this document exists

Larb runs autonomously, reads source code, executes commands, holds API credentials, and spends money. That makes it a high-value target and a high-blast-radius tool. Recent history shows the stakes are real: production coding agents have shipped flaws where simply opening an untrusted repository could trigger remote code execution or exfiltrate API keys before the user ever approved anything, and a popular extensible agent saw roughly a quarter of its community skills carry at least one vulnerability. Larb's differentiator is that these classes are designed out, not patched after the fact.

## 2. Assets we protect

| Asset | Why it matters |
|---|---|
| **User source code & secrets in the repo** | Confidentiality and integrity of the user's primary work product. |
| **Credentials** (model API keys, git tokens, cloud creds) | Theft enables impersonation, unauthorized spend, lateral movement. |
| **The host system** | The agent must not be a path to arbitrary host compromise. |
| **The user's money** | API spend is real; runaway loops can cost hundreds overnight. |
| **Integrity of agent output** | Code Larb writes/ships must not be silently subverted (e.g., injected backdoors). |
| **The skill/plugin supply chain** | A poisoned skill or registry can compromise every user who installs it. |

## 3. Trust boundaries

**Trusted:**
- The user and their explicit, in-session decisions.
- Signed first-party Larb code and signed/verified skills.

**Untrusted (treat all input from these as adversarial):**
- **Repository contents** — code, config files, READMEs, file names, commit messages. Anything in a repo may be attacker-authored.
- **Model output** — the LLM can be manipulated via injected instructions and may propose dangerous actions.
- **Community skills/plugins** — until signed/verified, assume hostile.
- **Network/tool responses** — web pages, MCP servers, package registries.
- **Environment** picked up implicitly (env vars, ambient config) — never trusted as authorization.

The core invariant: **untrusted input can propose, but only the user can authorize.** Reading data is never the same as acting on it.

## 4. Adversaries

- **Malicious repository author** — crafts a repo so that opening or operating on it compromises the user.
- **Malicious / vulnerable skill author** — publishes a skill that overreaches or is exploitable.
- **Prompt-injection attacker** — plants instructions in code, docs, issues, or web content the agent will read.
- **Network adversary / compromised provider endpoint** — MITM or a hostile API base URL.
- **Supply-chain attacker** — compromises a dependency, the skills SDK, or the registry.
- **Curious/over-trusting user** — not an attacker, but a threat surface; the design must make the safe path the easy path.

## 5. Attack classes we design out

Each entry: **threat → mitigation → residual risk.** The mitigations are requirements on the implementation, not aspirations.

### 5.1 Config-triggered execution on repo open
- **Threat:** opening/cloning a repo causes code or config-as-code to run, before any trust decision (the RCE class seen in the wild).
- **Mitigation:** the **trust-before-anything boot sequence**. On opening a directory, Larb reads zero executable/config-as-code and makes zero network calls until the user makes a trust decision. Config files are *declarative only* and can never trigger execution, register hooks, or run on load.
- **Residual risk:** a user who blanket-trusts everything; mitigated by clear, scoped trust prompts and sane defaults.

### 5.2 Secret exfiltration / API-base-URL redirect before consent
- **Threat:** repo-controlled settings redirect API traffic to an attacker endpoint, leaking keys, before the trust prompt (the key-exfiltration class seen in the wild).
- **Mitigation:** the **secret broker** — the agent never holds raw keys; the broker injects them only into calls to allow-listed, user-confirmed hosts. Repo config can never set or override the API base URL. No outbound request fires before consent (see 5.1).
- **Residual risk:** a user manually approving a malicious host; mitigated by surfacing the destination host in the consent prompt.

### 5.3 Approval bypass via repo config, hooks, or MCP
- **Threat:** repo-provided hooks/MCP definitions or settings silently grant capabilities or pre-approve tool use.
- **Mitigation:** approvals live solely in the **permission engine** and the user's session/project policy. Repo-supplied definitions are *proposals* shown to the user, never authorizations. Hooks/MCP servers are themselves capability-gated.
- **Residual risk:** approval fatigue leading to rubber-stamping; mitigated by batching, clear scoping, and "allow once / session / always" granularity.

### 5.4 Malicious or vulnerable community skill
- **Threat:** an installed skill overreaches (touches files/hosts it shouldn't) or is exploitable.
- **Mitigation:** every skill ships a **capability manifest**; Larb enforces exactly that and nothing more. Skills run **isolated** (worker/process/WASM), never in-process with host access. Unsigned community skills get the tightest sandbox and explicit consent; *verified*/*first-party* require review + signing.
- **Residual risk:** a signed-but-still-buggy skill, or a manifest that the user grants too broadly; mitigated by review for verified tiers and least-privilege defaults.

### 5.5 Runaway spend
- **Threat:** an autonomous or scheduled loop burns through API budget (the "heartbeat cost hundreds overnight" class).
- **Mitigation:** the **cost governor** enforces hard per-run/session/day limits that *halt* the agent, not merely warn, plus live token/$ accounting.
- **Residual risk:** limits set too high by the user; mitigated by conservative defaults and provider-side limit guidance in docs.

### 5.6 Sandbox escape (command execution)
- **Threat:** a command the agent runs escapes isolation to reach the host fs/network/processes.
- **Mitigation:** command execution runs in a **rootless container (optionally microVM)** with a project-scoped filesystem view, no ambient host secrets/env, and allow-listed network egress per run.
- **Residual risk:** kernel/container-runtime CVEs; mitigated by the microVM option for high-risk use and keeping the runtime patched.

### 5.7 Prompt injection that drives action
- **Threat:** instructions hidden in repo files, issues, or fetched web content steer the model into exfiltration or dangerous commands.
- **Mitigation:** model output is **untrusted** (§3) and cannot self-authorize — every consequential action still passes the permission engine and sandbox. Network egress and secret access remain gated regardless of what the model "decides." Context-poisoning guards in the context engine flag/limit injected instruction patterns.
- **Residual risk:** injection that produces *plausible but subtly wrong* code; mitigated partially by the verification loop, but human review of diffs remains essential. This is an open research area — see §7.

### 5.8 Plugin in-process host access
- **Threat:** a plugin loaded in the host runtime inherits full host privileges (a known weakness in in-process Node-plugin ecosystems).
- **Mitigation:** **mandatory isolation** for all plugins/skills; no in-process execution with host capabilities. Capabilities are mediated through the manifest + permission engine only.
- **Residual risk:** isolation-layer bugs; treated as in-scope, high-severity security issues.

### 5.9 Context poisoning / memory tampering
- **Threat:** untrusted repo content pollutes long-lived memory or context to manipulate future runs.
- **Mitigation:** memory is **per-project scope-guarded**, inspectable (markdown-on-disk), and subject to injection limits; compaction summarizes rather than blindly retaining adversarial text.
- **Residual risk:** slow-drift manipulation; mitigated by user-visible memory and easy reset.

### 5.10 Supply-chain compromise
- **Threat:** a poisoned dependency, SDK, or registry entry compromises users at install time.
- **Mitigation:** signing/provenance on first-party artifacts and verified skills, lockfile + dependency review in CI, and content-hashing of skills. Install ≠ trust: installation never grants capabilities.
- **Residual risk:** zero-day in a trusted upstream; mitigated by minimizing the trusted dependency surface and prompt patching.

## 6. The core invariants (one-line summary)

1. Nothing networked or executed runs before an explicit, informed trust decision.
2. Reading untrusted input never authorizes action — only the user does.
3. The agent never holds raw secrets; the broker injects them into allow-listed calls only.
4. Every tool, command, and skill runs under an enforced, least-privilege capability scope.
5. Hard spend limits stop the agent; they don't just warn.
6. Everything consequential is logged in an append-only audit trail.

## 7. Out of scope / open questions

- **Out of scope:** physical attacks, an already-root-compromised host, malicious local users, and bugs inside third-party skills (their *containment* is in scope; their internal flaws are not).
- **Open questions:**
  - How aggressively should context-poisoning guards intervene before they hurt legitimate use? (Related to the open decision on plugin isolation.)
  - Default sandbox baseline: container-only vs. container + microVM?
  - Strength/UX of the trust prompts — how to avoid approval fatigue without weakening the boundary.
  - Whether to ship a default model provider, and how that interacts with the secret broker on first run.

## 8. Maintenance

This document is reviewed each minor release and whenever a component in §5 changes. Security-relevant PRs should reference the section(s) they affect. Reporting process and scope live in [`SECURITY.md`](./SECURITY.md).
