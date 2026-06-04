import { resolve } from "node:path";
import {
  type ExecResult,
  type IsolationInfo,
  type NetworkMode,
  type SandboxBackend,
  type SandboxOptions,
  spawnCapture,
} from "./backend.js";

export interface ContainerOptions extends SandboxOptions {
  /** Container runtime binary, e.g. "docker" or "podman". */
  runtime: string;
  /** OCI image the command runs in. */
  image: string;
  /** Egress posture. "none" disables networking entirely (the strong default). */
  network: Extract<NetworkMode, "none" | "allowlist">;
  /** Mount point for the project inside the container (default /workspace). */
  workdir?: string;
  /** Injectable process runner; defaults to the real one (overridden in tests). */
  runner?: typeof spawnCapture;
}

const DEFAULT_WORKDIR = "/workspace";
const MEMORY_LIMIT = "2g";
const PIDS_LIMIT = "256";

/**
 * Real isolation backend: runs each command in a throwaway rootless container
 * (docker/podman). The project is bind-mounted read-write at {@link DEFAULT_WORKDIR}
 * and nothing else is reachable — the host filesystem outside the project is
 * invisible, no host environment (and therefore no secret) is passed in, and
 * networking is disabled by default (`--network none`). This is the SPEC's
 * Codex-parity isolation primitive (§7.3/§8/§9).
 *
 * The runtime CLI itself runs with the host environment (it needs PATH/DOCKER_HOST
 * to reach the daemon); container confinement is enforced by the runtime flags,
 * not by scrubbing the CLI's env — only `-e LARB_SANDBOX=1` crosses into the
 * container.
 */
export class ContainerBackend implements SandboxBackend {
  readonly isolation: IsolationInfo;
  private readonly workdir: string;

  constructor(private readonly opts: ContainerOptions) {
    this.workdir = opts.workdir ?? DEFAULT_WORKDIR;
    this.isolation = {
      backend: "container",
      reducedIsolation: false,
      network: opts.network,
      runtime: opts.runtime,
      note:
        opts.network === "none"
          ? `container (${opts.runtime}:${opts.image}) — network disabled (--network none)`
          : `container (${opts.runtime}:${opts.image}) — network enabled; per-host allow-listing is via the governed http_fetch tool, raw command egress is not yet host-filtered`,
    };
  }

  /** Build the runtime argv for a command. Pure + exported for testing. */
  buildArgs(command: string): string[] {
    return [
      "run",
      "--rm",
      "--network",
      this.opts.network === "none" ? "none" : "bridge",
      "-v",
      `${resolve(this.opts.projectRoot)}:${this.workdir}`,
      "--workdir",
      this.workdir,
      "--memory",
      MEMORY_LIMIT,
      "--pids-limit",
      PIDS_LIMIT,
      "-e",
      "LARB_SANDBOX=1",
      this.opts.image,
      "sh",
      "-c",
      command,
    ];
  }

  run(command: string): Promise<ExecResult> {
    const runner = this.opts.runner ?? spawnCapture;
    return runner(
      this.opts.runtime,
      this.buildArgs(command),
      {
        cwd: resolve(this.opts.projectRoot),
        // Host env so the runtime CLI can find its daemon; the *container's* env
        // is controlled solely by the -e flags above, never the host's.
        env: process.env,
        shell: false,
        timeoutMs: this.opts.timeoutMs ?? 120_000,
        maxBytes: this.opts.maxOutputBytes ?? 1024 * 1024,
      },
      command,
    );
  }
}
