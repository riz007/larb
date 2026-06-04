import { spawn } from "node:child_process";

export interface SandboxOptions {
  /** Project root; the command's cwd / bind-mount is confined to this directory. */
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

/** Network egress posture for a backend. */
export type NetworkMode = "none" | "allowlist" | "host";

/**
 * How strongly the active backend confines commands — surfaced to the user so a
 * trust/run decision is informed (principle 1: safe by default, powerful by
 * consent). `reducedIsolation` is true when commands can reach the host
 * filesystem or network directly.
 */
export interface IsolationInfo {
  backend: "spawn" | "container";
  reducedIsolation: boolean;
  network: NetworkMode;
  /** Container runtime in use, if any. */
  runtime?: string;
  /** Human-readable one-liner for the TUI and audit log. */
  note: string;
}

/** Scoped command execution. Backends differ only in how strongly they confine. */
export interface SandboxBackend {
  readonly isolation: IsolationInfo;
  run(command: string): Promise<ExecResult>;
}

/**
 * Environment variables passed through to sandboxed commands. Everything else —
 * crucially every *_API_KEY, *_TOKEN, AWS_*, etc. — is stripped so the agent's
 * commands never inherit host secrets.
 */
export const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TERM",
  "USER",
  "SHELL",
  "TZ",
] as const;

/** Host env filtered to the allowlist, marked as confined. Used by SpawnBackend. */
export function scrubbedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  // Mark the sandbox so child processes / skills can detect confinement.
  env.LARB_SANDBOX = "1";
  return env;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated at ${max} bytes]`;
}

/**
 * Spawn a process, capture bounded stdout/stderr, and enforce a wall-clock
 * timeout with SIGKILL. Both backends funnel through this — they only differ in
 * the file/args/env they hand it. `shell` is true only for the spawn backend
 * (running the user command directly); the container backend passes the command
 * as a single argv element to `sh -c`, so it never needs a host shell.
 */
export function spawnCapture(
  file: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; shell: boolean; timeoutMs: number; maxBytes: number },
  displayCommand: string,
): Promise<ExecResult> {
  const start = Date.now();
  return new Promise<ExecResult>((resolvePromise) => {
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: opts.shell,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const capture = (chunk: Buffer, into: "out" | "err") => {
      const text = chunk.toString("utf8");
      if (into === "out") {
        if (stdout.length < opts.maxBytes) stdout += text;
      } else if (stderr.length < opts.maxBytes) stderr += text;
    };

    child.stdout?.on("data", (c: Buffer) => capture(c, "out"));
    child.stderr?.on("data", (c: Buffer) => capture(c, "err"));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    const finish = (code: number | null) => {
      clearTimeout(timer);
      resolvePromise({
        command: displayCommand,
        code,
        stdout: truncate(stdout, opts.maxBytes),
        stderr: truncate(stderr, opts.maxBytes),
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
