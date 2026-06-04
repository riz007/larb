import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContainerBackend } from "./container.js";
import { SpawnBackend } from "./spawn.js";
import { Sandbox, detectRuntime } from "./executor.js";
import type { ExecResult } from "./backend.js";

const PROJECT = "/tmp/larb-proj";
// A real directory for tests that actually spawn a process (need a valid cwd).
const REAL_DIR = mkdtempSync(join(tmpdir(), "larb-sb-"));

function fakeRunner() {
  return vi.fn(
    async (
      _file: string,
      _args: string[],
      _opts: unknown,
      command: string,
    ): Promise<ExecResult> => ({
      command,
      code: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }),
  );
}

describe("ContainerBackend argv", () => {
  it("disables networking and mounts only the project (network=none)", () => {
    const backend = new ContainerBackend({
      projectRoot: PROJECT,
      runtime: "docker",
      image: "node:20",
      network: "none",
    });
    const args = backend.buildArgs("pnpm test");

    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    // network is disabled
    const netIdx = args.indexOf("--network");
    expect(args[netIdx + 1]).toBe("none");
    // project is bind-mounted at the fixed workdir, and nothing else
    expect(args).toContain(`${PROJECT}:/workspace`);
    const workIdx = args.indexOf("--workdir");
    expect(args[workIdx + 1]).toBe("/workspace");
    // the command is passed as a single argv element to sh -c (no host shell)
    expect(args.slice(-3)).toEqual(["sh", "-c", "pnpm test"]);
  });

  it("never passes host secrets into the container", () => {
    const backend = new ContainerBackend({
      projectRoot: PROJECT,
      runtime: "podman",
      image: "node:20",
      network: "allowlist",
    });
    const args = backend.buildArgs("env");
    const envFlags = args.filter((_, i) => args[i - 1] === "-e");
    // Only the confinement marker crosses the boundary — no *_API_KEY / *_TOKEN.
    // (No proxy URL passed ⇒ no proxy env yet.)
    expect(envFlags).toEqual(["LARB_SANDBOX=1"]);
    // allowlist mode keeps networking on (bridge); egress is gated by the proxy
    expect(args[args.indexOf("--network") + 1]).toBe("bridge");
  });

  it("routes egress through the host proxy in allowlist mode", () => {
    const backend = new ContainerBackend({
      projectRoot: PROJECT,
      runtime: "docker",
      image: "node:20",
      network: "allowlist",
      egressAllow: ["registry.npmjs.org"],
    });
    const args = backend.buildArgs("npm ci", "http://host.docker.internal:54321");
    expect(args).toContain("--add-host");
    expect(args).toContain("host.docker.internal:host-gateway");
    const envFlags = args.filter((_, i) => args[i - 1] === "-e");
    expect(envFlags).toContain("HTTPS_PROXY=http://host.docker.internal:54321");
    expect(envFlags).toContain("LARB_SANDBOX=1");
    expect(backend.isolation.note).toContain("registry.npmjs.org");
  });

  it("reports non-reduced isolation and the chosen runtime", () => {
    const backend = new ContainerBackend({
      projectRoot: PROJECT,
      runtime: "docker",
      image: "node:20",
      network: "none",
    });
    expect(backend.isolation.reducedIsolation).toBe(false);
    expect(backend.isolation.runtime).toBe("docker");
    expect(backend.isolation.network).toBe("none");
  });

  it("invokes the runtime binary with the built args", async () => {
    const runner = fakeRunner();
    const backend = new ContainerBackend({
      projectRoot: PROJECT,
      runtime: "docker",
      image: "node:20",
      network: "none",
      runner,
    });
    await backend.run("echo hi");
    expect(runner).toHaveBeenCalledOnce();
    const [file, args] = runner.mock.calls[0]!;
    expect(file).toBe("docker");
    expect(args.slice(-3)).toEqual(["sh", "-c", "echo hi"]);
  });
});

describe("SpawnBackend", () => {
  it("reports reduced isolation with host network reachable", () => {
    const backend = new SpawnBackend({ projectRoot: PROJECT });
    expect(backend.isolation.reducedIsolation).toBe(true);
    expect(backend.isolation.network).toBe("host");
  });

  it("runs commands and captures output", async () => {
    const backend = new SpawnBackend({ projectRoot: REAL_DIR });
    const res = await backend.run("echo larb-ok");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("larb-ok");
  });

  it("does not leak host secrets to the command env", async () => {
    process.env.SECRET_TOKEN_XYZ = "should-not-appear";
    const backend = new SpawnBackend({ projectRoot: REAL_DIR });
    const res = await backend.run("echo $SECRET_TOKEN_XYZ");
    expect(res.stdout).not.toContain("should-not-appear");
    delete process.env.SECRET_TOKEN_XYZ;
  });
});

describe("Sandbox backend selection", () => {
  it("uses the reduced-isolation spawn backend when explicitly requested", () => {
    const sandbox = new Sandbox({ projectRoot: PROJECT, backend: "spawn" });
    expect(sandbox.isolation.backend).toBe("spawn");
    expect(sandbox.isolation.reducedIsolation).toBe(true);
  });

  it("auto selects container when a runtime exists, else falls back to spawn", () => {
    const sandbox = new Sandbox({ projectRoot: PROJECT, backend: "auto" });
    const expected = detectRuntime() ? "container" : "spawn";
    expect(sandbox.isolation.backend).toBe(expected);
  });

  it("refuses to silently downgrade when container is required but unavailable", () => {
    // Only assertable on a host without a runtime; skip where one is installed.
    if (detectRuntime()) return;
    expect(() => new Sandbox({ projectRoot: PROJECT, backend: "container" })).toThrow(
      /no container runtime/i,
    );
  });
});
