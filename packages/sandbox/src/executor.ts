import { spawn } from "node:child_process";
import { resolve } from "node:path";

export interface SandboxOptions {
  /** Project root; the command's cwd is confined to this directory. */
  projectRoot: string;
  /** Wall-clock timeout in ms (default 120s). */
  timeoutMs?: number;
  /** Max captured output bytes per stream (default 1 MiB). */
  maxOutputBytes?: number;
}

export interface ExecResult {
  command: string;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/**
 * Environment variables passed through to sandboxed commands. Everything else —
 * crucially every *_API_KEY, *_TOKEN, AWS_*, etc. — is stripped so the agent's
 * commands never inherit host secrets.
 */
const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TERM",
  "USER",
  "SHELL",
  "TZ",
];

function scrubbedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  // Mark the sandbox so child processes / skills can detect confinement.
  env.LARB_SANDBOX = "1";
  return env;
}

/**
 * Scoped command execution.
 *
 * v1 isolation: cwd confined to the project root, host secrets stripped from the
 * environment, output and wall-clock bounded. The production target is a
 * rootless OCI container / microVM; this Sandbox is the swappable seam for that
 * — same interface, stronger backend. Network egress is gated upstream by the
 * permission engine (`net` capability) rather than here.
 */
export class Sandbox {
  constructor(private readonly opts: SandboxOptions) {}

  run(command: string): Promise<ExecResult> {
    const cwd = resolve(this.opts.projectRoot);
    const timeoutMs = this.opts.timeoutMs ?? 120_000;
    const maxBytes = this.opts.maxOutputBytes ?? 1024 * 1024;
    const start = Date.now();

    return new Promise<ExecResult>((resolvePromise) => {
      const child = spawn(command, {
        cwd,
        env: scrubbedEnv(),
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const capture = (chunk: Buffer, into: "out" | "err") => {
        const text = chunk.toString("utf8");
        if (into === "out") {
          if (stdout.length < maxBytes) stdout += text;
        } else if (stderr.length < maxBytes) stderr += text;
      };

      child.stdout.on("data", (c: Buffer) => capture(c, "out"));
      child.stderr.on("data", (c: Buffer) => capture(c, "err"));

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      const finish = (code: number | null) => {
        clearTimeout(timer);
        resolvePromise({
          command,
          code,
          stdout: truncate(stdout, maxBytes),
          stderr: truncate(stderr, maxBytes),
          timedOut,
          durationMs: Date.now() - start,
        });
      };

      child.on("error", (err) => {
        stderr += `\n[sandbox] failed to spawn: ${err.message}`;
        finish(null);
      });
      child.on("close", (code) => finish(code));
    });
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated at ${max} bytes]`;
}
