import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  // Isolate ~/.larb writes (permissions/spend) to a throwaway dir.
  process.env.LARB_HOME = mkdtempSync(join(tmpdir(), "larb-home-"));
});

describe("CostGovernor", () => {
  it("halts with a hard error when the per-run limit is hit", async () => {
    const { CostGovernor, SpendLimitError } = await import("./cost.js");
    const gov = new CostGovernor({ perRun: 0.01, perSession: 100, perDay: 100 });
    expect(() =>
      gov.record({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 0.02),
    ).toThrow(SpendLimitError);
  });
});

describe("PermissionEngine", () => {
  it("lets deny-policy win over everything", async () => {
    const { PermissionEngine, PermissionDeniedError } = await import("./permission.js");
    const engine = new PermissionEngine({
      projectRoot: "/proj",
      approver: async () => "always",
      policy: { deny: [{ capability: "exec" }] },
    });
    await expect(
      engine.require({ capability: "exec", path: "/proj", command: "rm -rf /", reason: "x" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("auto-denies unknown requests in read-only mode without prompting", async () => {
    const { PermissionEngine, PermissionDeniedError } = await import("./permission.js");
    let prompted = false;
    const engine = new PermissionEngine({
      projectRoot: "/proj",
      approver: async () => {
        prompted = true;
        return "always";
      },
      autoDenyUnknown: true,
    });
    await expect(
      engine.require({ capability: "fs.write", path: "/proj/a.ts", reason: "x" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(prompted).toBe(false);
  });

  it("remembers an allow-session grant for the rest of the session", async () => {
    const { PermissionEngine } = await import("./permission.js");
    let calls = 0;
    const engine = new PermissionEngine({
      projectRoot: "/proj",
      approver: async () => {
        calls++;
        return "allow-session";
      },
    });
    await engine.require({ capability: "fs.write", path: "/proj/a.ts", reason: "x" });
    await engine.require({ capability: "fs.write", path: "/proj/b.ts", reason: "y" });
    expect(calls).toBe(1);
  });
});

describe("TrustEngine", () => {
  it("reports untrusted directories as untrusted", async () => {
    const { TrustEngine } = await import("./trust.js");
    const engine = new TrustEngine();
    const dir = mkdtempSync(join(tmpdir(), "larb-proj-"));
    expect(engine.isTrusted(dir)).toBe(false);
    engine.trust(dir, "full");
    expect(engine.status(dir)?.scope).toBe("full");
  });
});
