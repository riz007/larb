import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { JsonRpcMessage, McpServerConfig } from "./types.js";

/**
 * A bidirectional channel to an MCP server. The client only knows this
 * interface, so SSE/HTTP (or the official SDK) can be dropped in later without
 * touching the client, manager, or wiring.
 */
export interface Transport {
  start(): Promise<void>;
  /** Write one JSON-RPC message. */
  send(message: unknown): void;
  /** Register the handler for inbound JSON-RPC messages (responses + notifications). */
  onMessage(handler: (msg: JsonRpcMessage) => void): void;
  /** Register a fatal-error handler (spawn failure, premature exit). */
  onError(handler: (err: Error) => void): void;
  close(): Promise<void>;
}

/** A minimal PATH/HOME baseline so the server can find its runtime. */
const ENV_BASELINE = ["PATH", "HOME", "LANG", "TMPDIR", "TERM", "USER", "SHELL"];

/**
 * Build the child env: a scrubbed baseline plus only the explicitly configured
 * `env`, with `${VAR}` expanded from the host environment. Host secrets are
 * withheld unless the user opts each one in — the same posture as the skill
 * sandbox.
 */
export function buildChildEnv(configured?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { LARB_MCP: "1" };
  for (const k of ENV_BASELINE) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  for (const [k, raw] of Object.entries(configured ?? {})) {
    env[k] = raw.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) =>
      process.env[name] ?? "",
    );
  }
  return env;
}

/**
 * stdio transport: spawn the server and exchange newline-delimited JSON-RPC over
 * its stdin/stdout (the MCP stdio convention — one message per line, no embedded
 * newlines). stderr is surfaced as diagnostics, never parsed as protocol.
 */
export class StdioTransport implements Transport {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private messageHandler: (msg: JsonRpcMessage) => void = () => {};
  private errorHandler: (err: Error) => void = () => {};
  private closed = false;

  constructor(
    private readonly config: McpServerConfig,
    private readonly onStderr?: (line: string) => void,
  ) {}

  async start(): Promise<void> {
    const child = spawn(this.config.command, this.config.args ?? [], {
      env: buildChildEnv(this.config.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    child.on("error", (err) => this.errorHandler(err));
    child.on("exit", (code, signal) => {
      if (!this.closed) {
        this.errorHandler(
          new Error(`MCP server "${this.config.name}" exited (code=${code} signal=${signal})`),
        );
      }
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.ingest(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const text = chunk.trimEnd();
      if (text) this.onStderr?.(text);
    });

    // Surface an immediate spawn failure (e.g. command not found) rather than
    // hanging on the first request.
    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child.off("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        child.off("spawn", onSpawn);
        reject(err);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });
  }

  send(message: unknown): void {
    if (!this.child || this.closed) throw new Error("transport not started");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  onMessage(handler: (msg: JsonRpcMessage) => void): void {
    this.messageHandler = handler;
  }

  onError(handler: (err: Error) => void): void {
    this.errorHandler = handler;
  }

  async close(): Promise<void> {
    this.closed = true;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end();
    child.kill("SIGTERM");
    // Give it a moment to exit cleanly, then force-kill.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      try {
        this.messageHandler(JSON.parse(line) as JsonRpcMessage);
      } catch {
        // A non-JSON line on stdout is a misbehaving server; report, don't crash.
        this.onStderr?.(`non-JSON stdout from "${this.config.name}": ${line.slice(0, 200)}`);
      }
    }
  }
}
