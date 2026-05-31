# Contributing to Larb

Thanks for your interest in contributing to **Larb · The Autonomous Coding Agent**. This guide covers how to set up, what we expect, and how your work becomes part of the project.

Larb is **security-first, model-agnostic, and open**. Every contribution should reinforce those principles. A public design document for contributors is in the works; until then, the README and this guide describe the project's direction.

---

## Ground rules

- **Be respectful and constructive.** Harassment or hostility isn't tolerated (see `CODE_OF_CONDUCT.md`).
- **Sign the CLA.** You must agree to the [Contributor License Agreement](./CLA.md) before any pull request can be merged. The CLA bot will prompt you on your first PR.
- **Tie your work to a goal.** Every non-trivial PR should advance one of the project's principles or a planned milestone. If the direction isn't clear, open an issue or discussion to align first.
- **Never report security issues in public.** Vulnerabilities go through the private process in [`SECURITY.md`](./SECURITY.md) — not public issues or PRs.

## Before you start

- Search existing [issues](../../issues) and [discussions](../../discussions) first.
- For anything non-trivial (new tool, provider adapter, sandbox change, skill-system change), **open an issue or discussion to align on the approach before writing code.** This saves everyone a rejected PR.
- Typo fixes, docs, and tiny improvements can go straight to a PR.

## Development setup

**Prerequisites:** Node.js LTS (22+), [pnpm](https://pnpm.io/), and git.

```bash
git clone https://github.com/<your-fork>/larb.git
cd larb
pnpm install
pnpm build        # turbo build across packages
pnpm test         # run the test suite
pnpm lint         # eslint + prettier check
pnpm typecheck    # tsc --noEmit, strict mode
```

Larb is a TypeScript monorepo (pnpm workspaces). The package layout lives under `packages/` — `core`, `providers`, `sandbox`, `context`, `governors`, and `cli` — with more (e.g. a skills SDK) planned.

## Branching & pull-request workflow

1. Fork the repo and create a branch: `feat/<short-name>`, `fix/<short-name>`, or `docs/<short-name>`.
2. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
3. Keep PRs focused — one logical change per PR.
4. Fill out the PR template, including which project goal the change serves.
5. CI must pass: **lint, typecheck, test, build.** PRs that lower coverage on changed code or weaken a security default will be asked for justification.
6. At least one maintainer review is required. Changes to the trust engine, permission engine, sandbox, secret broker, cost governor, or skill signing require review from a **security maintainer**.
7. We squash-merge.

## Coding standards

- **TypeScript strict mode.** Avoid `any`; if unavoidable, comment why.
- **ESLint + Prettier** enforced in CI — run `pnpm lint --fix` before pushing.
- **Tests for new behavior.** Larb's whole ethos is "verify, don't trust" — code should hold itself to the same bar.
- **Security defaults are sacred.** Never widen a default capability, never log secrets or raw API keys, and never add a code path that executes repo-provided config on load. New tools must declare their required capabilities to the permission engine.

## Contributing skills & plugins (governed extensibility)

This is where Larb deliberately differs from comparable ecosystems. To get a skill or plugin accepted:

- **Ship a manifest** declaring every capability it needs (filesystem paths, network hosts, command execution, secret access). Larb enforces exactly that manifest and nothing more.
- **No ambient host access.** Plugins run in isolation (worker/process/WASM) — never in-process with host privileges.
- **Trust tiers:** community skills are unsigned and run in the tightest sandbox with explicit user consent; *verified* and *first-party* skills require maintainer review and signing.
- Anything touching trust, permissions, sandboxing, secrets, or cost gets a mandatory security review.

## Reporting bugs & requesting features

- **Bugs:** open an issue with repro steps, expected vs. actual, version, OS, and the model/provider in use.
- **Features:** open a discussion describing the problem first; tie it to a project goal where you can.
- **Security:** see [`SECURITY.md`](./SECURITY.md). Do not open a public issue.

## License of contributions

By contributing, you agree your contributions are licensed under the project's **Apache-2.0** license, and you agree to the [CLA](./CLA.md), which grants the project owner the consolidated rights needed to maintain and, where applicable, dual-license Larb. You retain copyright to your contributions.

Welcome aboard. 🦞
