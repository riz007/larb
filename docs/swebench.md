# SWE-bench evaluation

Larb measures the §14 quality metric — resolution rate — with a SWE-bench-style
harness built on the generic benchmark runner (`packages/core/src/bench.ts`).
This doc explains what ships today and how to assemble a full graded run.

## What ships

`packages/core/src/swebench.ts` provides the dataset-agnostic pieces:

| Export | Purpose |
|---|---|
| `parseSweBench(jsonl)` | Parse a SWE-bench JSONL file into `SweBenchInstance[]` (normalizes `FAIL_TO_PASS`/`PASS_TO_PASS`, which the dataset stores as arrays *or* JSON strings). |
| `toBenchTask(instance)` | Map an instance to a `BenchTask` — the agent only ever sees `problem_statement`, never the gold patch or tests. |
| `applyPatch(dir, patch)` | Apply a unified diff to a git worktree via `git apply`. Used to lay down the instance's `test_patch` before grading. |
| `isResolved(instance, passedTests)` | The grading rule: resolved iff every `FAIL_TO_PASS` test passes **and** every `PASS_TO_PASS` test still passes. |

CLI:

```bash
larb bench --swebench instances.jsonl
```

runs the agent on each instance's problem statement, each in its own isolated
git worktree (`Worktree`), and reports cost/task + a coarse resolution by the
**project's own verify loop**.

## Assembling a fully-graded run

True SWE-bench grading needs each instance's repository, which the bundled
command does not fetch (it would clone many third-party repos over the network
and shell out to per-repo, per-language test commands). To build a complete
harness, drive the exported primitives:

1. **Per instance**, check out its repo at `base_commit` (a `Worktree`, or a
   fresh clone). This is the agent's working tree.
2. Run the agent on `toBenchTask(instance)` (autonomous, sandboxed).
3. `applyPatch(dir, instance.testPatch)` to introduce the grading tests.
4. Run the instance's test command and collect which test ids passed.
5. `isResolved(instance, passedTests)` → resolved or not.
6. Aggregate with `summarize(...)`/`formatReport(...)` from `@larb/core`.

Steps 1 and 4 are environment-specific (network access, language toolchains,
per-repo test invocation), so they live in the caller, not in core. Run the
agent under the **container sandbox** (`[sandbox] backend = "container"`) so
untrusted repo code executes in isolation — see `docs/verify-container.md`.

## Why grading is split this way

Keeping parse / map / patch / grade pure and in `core` makes them unit-testable
(`packages/core/src/swebench.test.ts`) and reusable, while the
resource-dependent fetch-and-run lives where the environment is known. The agent
never receives the gold patch or the test ids — only the problem statement —
so the metric reflects real problem-solving, not leakage.
