import { resolve } from "node:path";
import {
  type ExecResult,
  type IsolationInfo,
  type NetworkMode,
  type SandboxBackend,
  type SandboxOptions,
  spawnCapture,
} from "./backend.js";
import { EgressProxy } from "./egress.js";

export interface ContainerOptions extends SandboxOptions {
  /** Container runtime binary, e.g. "docker" or "podman". */
  runtime: string;
  /** OCI image the command runs in. */
  image: string;
  /** Egress posture. "none" disables networking entirely (the strong default). */
  network: Extract<NetworkMode, "none" | "allowlist">;
  /** Hosts reachable in "allowlist" mode; every other host is denied. */
  egressAllow?: string[];
  /** Mount point for the project inside the container (default /workspace). */
  workdir?: string;
  /** Injectable process runner; defaults to the real one (overridden in tests). */
  runner?: typeof spawnCapture;
}

const DEFAULT_WORKDIR = "/workspace";
const MEMORY_LIMIT = "2g";
const PIDS_LIMIT = "256";
/** Hostname the container uses to reach the host machine (docker/podman convention). */
const HOST_GATEWAY_ALIAS = "host.docker.internal";

/**
 * Real isolation backend: runs each command in a throwaway rootless container
 * (docker/podman). The project is bind-mounted read-write at {@link DEFAULT_WORKDIR}
 * and nothing else is reachable — the host filesystem outside the project is
 * invisible, no host environment (and therefore no secret) is passed in, and
 * networking is disabled by default (`--network none`). This is the SPEC's
 * Codex-parity isolation primitive (§7.3/§8/§9).
 *
 * In `allowlist` mode, networking is enabled but routed through a host-side
 * {@link EgressProxy}: the container's HTTP(S)_PROXY points at the proxy, which
 * permits only the configured hosts (default-deny). Proxy-respecting clients
 * (package managers, curl, fetch) are filtered per-host.
 *
 * The runtime CLI itself runs with the host environment (it needs PATH/DOCKER_HOST
 * to reach the daemon); container confinement is enforced by the runtime flags,
 * not by scrubbing the CLI's env — only the marker + proxy vars cross into the
 * container.
 */
export class ContainerBackend implements SandboxBackend {
  readonly isolation: IsolationInfo;
  private readonly workdir: string;
  private readonly egressAllow: string[];
  private proxy: EgressProxy | null = null;
  private proxyUrl: string | undefined;

  constructor(private readonly opts: ContainerOptions) {
    this.workdir = opts.workdir ?? DEFAULT_WORKDIR;
    this.egressAllow = opts.egressAllow ?? [];
    this.isolation = {
      backend: "container",
      reducedIsolation: false,
      network: opts.network,
      runtime: opts.runtime,
      note:
        opts.network === "none"
          ? `container (${opts.runtime}:${opts.image}) — network disabled (--network none)`
          : `container (${opts.runtime}:${opts.image}) — egress restricted to ${
              this.egressAllow.length ? this.egressAllow.join(", ") : "(no hosts — all denied)"
            } via host egress proxy`,
    };
  }

  /**
   * Build the runtime argv for a command. Pure + exported for testing.
   * Pass `proxyUrl` to route allow-listed egress through the host proxy.
   */
  buildArgs(command: string, proxyUrl = this.proxyUrl): string[] {
    const args = ["run", "--rm"];

    if (this.opts.network === "none") {
      args.push("--network", "none");
    } else {
      args.push("--network", "bridge");
      if (proxyUrl) {
        // Reach the host proxy and force all egress through it.
        args.push("--add-host", `${HOST_GATEWAY_ALIAS}:host-gateway`);
        for (const v of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) {
          args.push("-e", `${v}=${proxyUrl}`);
        }
        args.push("-e", "no_proxy=localhost,127.0.0.1");
      }
    }

    args.push(
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
    );
    return args;
  }

  /** Start the egress proxy once, on first networked run. */
  private async ensureProxy(): Promise<void> {
    if (this.opts.network !== "allowlist" || this.proxy) return;
    const allow = new Set(this.egressAllow);
    this.proxy = new EgressProxy((host) => allow.has(host));
    const port = await this.proxy.start();
    this.proxyUrl = `http://${HOST_GATEWAY_ALIAS}:${port}`;
  }

  /** Release the egress proxy (if any). */
  dispose(): void {
    this.proxy?.stop();
    this.proxy = null;
  }

  async run(command: string): Promise<ExecResult> {
    await this.ensureProxy();
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
