import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";
import {
  type ExecResult,
  type IsolationInfo,
  type SandboxBackend,
  type SandboxOptions,
} from "./backend.js";
import { SpawnBackend } from "./spawn.js";
import { ContainerBackend } from "./container.js";

/** Declarative sandbox policy (from trusted global config only). */
export interface SandboxConfig {
  /** "auto" picks container when a runtime exists, else spawn. */
  backend?: "auto" | "container" | "spawn";
  /** Container runtime to prefer ("docker" | "podman"); auto-detected if unset. */
  runtime?: string;
  /** OCI image for the container backend. */
  image?: string;
  /** Container egress posture. */
  network?: "none" | "allowlist";
}

const DEFAULT_IMAGE = "node:20";

/** Is `bin` present on the PATH? (No execution — pure filesystem probe.) */
function onPath(bin: string): boolean {
  const paths = (process.env.PATH ?? "").split(delimiter);
  return paths.some((p) => p && existsSync(join(p, bin)));
}

/** First available container runtime, preferring `prefer` if given. */
export function detectRuntime(prefer?: string): string | undefined {
  const candidates = prefer ? [prefer, "docker", "podman"] : ["docker", "podman"];
  for (const c of candidates) if (onPath(c)) return c;
  return undefined;
}

/** Choose a backend from policy + runtime availability. */
function selectBackend(opts: SandboxOptions & SandboxConfig): SandboxBackend {
  const desired = opts.backend ?? "auto";
  if (desired === "spawn") return new SpawnBackend(opts);

  const runtime = detectRuntime(opts.runtime);
  const image = opts.image ?? DEFAULT_IMAGE;
  const network = opts.network ?? "none";

  if (desired === "container") {
    if (!runtime) {
      throw new Error(
        '[sandbox] backend = "container" but no container runtime (docker/podman) was ' +
          'found on PATH. Install one, or set [sandbox] backend = "auto" or "spawn".',
      );
    }
    return new ContainerBackend({ ...opts, runtime, image, network });
  }

  // auto: prefer real isolation, fall back to reduced-isolation spawn.
  return runtime
    ? new ContainerBackend({ ...opts, runtime, image, network })
    : new SpawnBackend(opts);
}

/**
 * The sandbox callers use. It owns the swappable backend (spawn vs container)
 * and exposes the active {@link IsolationInfo} so the interface layer can tell
 * the user how strongly their commands are confined.
 */
export class Sandbox implements SandboxBackend {
  private readonly backend: SandboxBackend;
  readonly isolation: IsolationInfo;

  constructor(opts: SandboxOptions & SandboxConfig) {
    this.backend = selectBackend(opts);
    this.isolation = this.backend.isolation;
  }

  run(command: string): Promise<ExecResult> {
    return this.backend.run(command);
  }
}
