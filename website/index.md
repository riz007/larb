---
layout: home

hero:
  name: "Larb"
  text: "The security-first coding agent"
  tagline: "Open-source, model-agnostic, governed. A terminal-native autonomous engineer you can point at any model, extend with signed skills, and run without rate-limit cliffs or vendor lock-in — safe to open an untrusted repo by default."
  image:
    src: /larb-code.png
    alt: Larb
  actions:
    - theme: brand
      text: Architecture
      link: /architecture
    - theme: alt
      text: Why Larb (comparison)
      link: /comparison
    - theme: alt
      text: GitHub
      link: https://github.com/riz007/larb

features:
  - icon: 🔒
    title: Safe by default, powerful by consent
    details: Trust-before-anything boot — nothing is read-as-code, executed, or sent over the network before you make a trust decision. Real container isolation; dangerous capabilities are opt-in and scoped.
  - icon: 🔌
    title: No lock-in, ever
    details: One config line points Larb at Anthropic, OpenAI, Gemini, DeepSeek, Groq, Mistral, xAI, OpenRouter, Together, Perplexity, or a local Ollama model. You own your keys, data, and routing.
  - icon: ✅
    title: Verify, don't trust the model
    details: A mandatory verification loop runs your lint / build / tests after edits and feeds failures back until the task verifiably passes — output is shippable, not merely plausible.
  - icon: 💸
    title: Cost is a first-class signal
    details: Live token and dollar accounting with hard limits that halt the agent before overspend — never a surprise bill. Cache-aware pricing and cheap-worker routing keep long runs inexpensive.
  - icon: 🧩
    title: Extensible, but governed
    details: Community skills with signing, a declared-permission manifest, and tiered trust. Install ≠ trust — unsigned skills run in the tightest sandbox.
  - icon: 🔎
    title: Open and auditable end-to-end
    details: The client is not a black box. An append-only audit log records every model call, tool call, and permission grant. Apache-2.0.
---

## What is Larb?

**Larb** is an open-source, model-agnostic, **security-first** autonomous coding
agent. It plans, edits, runs, tests, and self-corrects until a task verifiably
passes — inside a capability sandbox, under a hard spend governor, with every
action logged.

The name is also a Lao/Thai dish (ลาบ) — a nod to the project's roots. This site
is bilingual: **[English](/)** · **[ไทย](/th/)**.

> ⚠️ **Status: `0.1.0-alpha`.** Early, BYO-key developers only. APIs and config
> may change. See the [roadmap](/roadmap) and the README's *Known limitations*.

### The wedge, in one sentence

Everyone else makes you choose between *open*, *safe*, *unlocked*, and *cheap*.
**Larb refuses that trade-off.** See the [comparison](/comparison) for how it
stacks up against Claude Code, Codex CLI, Gemini CLI, DeepSeek, Aider, and
OpenClaw.

### Explore

- **[Architecture](/architecture)** — the orchestrator loop, provider
  abstraction, sandbox, context engine, skills, and cross-cutting governors,
  with diagrams.
- **[Comparison](/comparison)** — the competitive landscape and where Larb wins.
- **[Roadmap](/roadmap)** — what's shipped (phases 0–7) and the ambitious plan
  ahead.
- **[Security model](/security)** — the differentiator: the attack classes Larb
  designs out.
