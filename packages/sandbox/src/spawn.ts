import { resolve } from "node:path";
import {
  type ExecResult,
  type IsolationInfo,
  type SandboxBackend,
  type SandboxOptions,
  scrubbedEnv,
  spawnCapture,
} from "./backend.js";

/**
 * Reduced-isolation backend: runs the command in a host subprocess with cwd
 * confined to the project root and host secrets stripped from the environment.
 *
 * It does NOT confine the filesystem (a command can still read paths outside the
 * project) or the network (egress is unrestricted). It is the fallback when no
 * container runtime is available; the user is told the isolation is reduced so
 * the trust decision stays informed. The production target is {@link ContainerBackend}.
 */
export class SpawnBackend implements SandboxBackend {
  readonly isolation: IsolationInfo = {
    backend: "spawn",
    reducedIsolation: true,
    network: "host",
    note: "spawn — reduced isolation: host filesystem and network are reachable from commands",
  };

  constructor(private readonly opts: SandboxOptions) {}

  run(command: string): Promise<ExecResult> {
    return spawnCapture(
      command,
      [],
      {
        cwd: resolve(this.opts.projectRoot),
        env: scrubbedEnv(),
        shell: true,
        timeoutMs: this.opts.timeoutMs ?? 120_000,
        maxBytes: this.opts.maxOutputBytes ?? 1024 * 1024,
      },
      command,
    );
  }
}
