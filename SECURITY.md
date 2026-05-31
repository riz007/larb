# Security Policy

Larb is a **security-first coding agent** — an autonomous tool that reads code, runs commands, and handles credentials. Security isn't a feature here; it's the product's main differentiator. We take reports seriously and run a coordinated-disclosure process.

For the design-level analysis of what Larb defends against, see [`threat-model.md`](./threat-model.md).

## Supported versions

| Version | Supported |
|---|---|
| Latest minor release | ✅ |
| Previous minor release | ✅ (critical fixes only) |
| Older / pre-1.0 | ❌ — please upgrade |

## Reporting a vulnerability

**Do not open a public issue, discussion, or pull request for security problems.**

Report privately via one of:

- **GitHub:** the repository's *Security → Report a vulnerability* (private advisory) — preferred.
- **Email:** **[security@your-domain]**, optionally encrypted with our PGP key (`[PGP KEY FINGERPRINT / link to public key]`).

Please include, where possible:
- A description of the issue and its impact.
- Steps to reproduce, or a proof of concept.
- Affected version(s), OS, and the model/provider in use.
- Any suggested remediation.

## Our process & timelines

- **Acknowledge:** within **3 business days**.
- **Triage & severity assessment:** within **7 business days**, using CVSS as a guide.
- **Fix:** we aim to ship a patch for critical issues within **30 days**; lower-severity issues are scheduled into normal releases.
- **Disclosure:** coordinated. We'll agree a disclosure date with you, credit you (unless you prefer to remain anonymous), and request a CVE where appropriate. Default embargo is up to **90 days**, shortened if a fix ships sooner or if the issue is being actively exploited.

## Scope

Because Larb's security guarantees are central, the following are **in scope** and treated as high priority:

- **Trust-engine bypass** — anything that causes Larb to read executable/config-as-code, make a network call, or execute commands *before* an explicit trust decision.
- **Sandbox escape** — escaping the command-execution sandbox or the plugin/skill isolation boundary to reach the host filesystem, network, or processes.
- **Secret exposure** — leakage of API keys or other credentials, including via a repo-controlled API base URL, logs, or telemetry. The agent should never see raw secrets (they're injected by the broker only into allow-listed calls).
- **Permission/approval bypass** — repo config, hooks, MCP servers, or skills overriding or circumventing the user's approval decisions.
- **Skill-manifest enforcement bypass** — a skill obtaining a capability (fs path, network host, exec, secret) it did not declare and the user did not grant.
- **Cost-governor bypass** — defeating the hard spend limits (runaway-spend protection).
- **Prompt-injection leading to action** — content in a repo, file, or web response steering the agent into exfiltration or dangerous command execution without consent.
- **Supply-chain issues** in first-party packages, the skills SDK, or the signing/provenance pipeline.

**Out of scope** (generally not eligible, though we still want to hear about severe cases):

- Vulnerabilities in **third-party, user-installed community skills/plugins** — report those to their authors. (Larb's manifest enforcement and isolation are meant to contain them; a *failure of that containment* is in scope.)
- Issues requiring an already-compromised host, root access, or a malicious local user.
- Self-inflicted misconfiguration where the user explicitly granted a dangerous capability after a clear warning.
- Missing best-practice headers, rate-limiting on docs sites, and similar low-impact findings without a concrete exploit.
- Social engineering of maintainers or users.

## Safe harbor

We support good-faith security research. If you make a genuine effort to comply with this policy — avoid privacy violations, data destruction, and service disruption; only interact with accounts/systems you own or have permission to test; and give us reasonable time to respond before disclosure — we will not pursue or support legal action against you, and we'll treat your research as authorized.

## Bug bounty

There is no paid bounty at this time. We credit reporters in advisories and release notes. This may change as the project matures.
