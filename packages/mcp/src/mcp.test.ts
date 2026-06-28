import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import type { PermissionEngine, PermissionRequest } from "@larb/governors";
import { McpManager, toolName } from "./manager.js";
import { buildChildEnv } from "./transport.js";
import type { McpServerConfig } from "./types.js";

const MOCK = fileURLToPath(new URL("./__fixtures__/mock-server.mjs", import.meta.url));

function mockServer(name = "mock"): McpServerConfig {
  return { name, command: process.execPath, args: [MOCK] };
}

/** A permission engine that records requests and allows everything. */
function allowAll(): { engine: PermissionEngine; seen: PermissionRequest[] } {
  const seen: PermissionRequest[] = [];
  const engine = {
    require: async (req: PermissionRequest) => {
      seen.push(req);
    },
  } as unknown as PermissionEngine;
  return { engine, seen };
}

describe("McpManager (stdio, against a real mock server)", () => {
  it("connects, lists tools, and namespaces them", async () => {
    const { engine } = allowAll();
    const mgr = new McpManager([mockServer()], { permission: engine });
    await mgr.connectAll();
    try {
      const tools = mgr.tools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(["mcp__mock__boom", "mcp__mock__echo"]);
      const echo = tools.find((t) => t.name === "mcp__mock__echo")!;
      expect(echo.description).toContain("[mcp: mock]");
      expect(echo.inputSchema).toMatchObject({ type: "object" });
    } finally {
      await mgr.closeAll();
    }
  });

  it("calls a tool through the permission engine and returns its content", async () => {
    const { engine, seen } = allowAll();
    const mgr = new McpManager([mockServer()], { permission: engine });
    await mgr.connectAll();
    try {
      const echo = mgr.tools().find((t) => t.name === "mcp__mock__echo")!;
      const r = await echo.execute({ text: "hi" });
      expect(r.ok).toBe(true);
      expect(r.content).toBe("echo: hi");
      // Gated by the mcp capability, scoped to the server.
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ capability: "mcp", host: "mock", command: "echo" });
    } finally {
      await mgr.closeAll();
    }
  });

  it("surfaces a tool error result as ok=false", async () => {
    const { engine } = allowAll();
    const mgr = new McpManager([mockServer()], { permission: engine });
    await mgr.connectAll();
    try {
      const boom = mgr.tools().find((t) => t.name === "mcp__mock__boom")!;
      const r = await boom.execute({});
      expect(r.ok).toBe(false);
      expect(r.content).toBe("kaboom");
    } finally {
      await mgr.closeAll();
    }
  });

  it("propagates a permission denial (never calls the server)", async () => {
    const engine = {
      require: async () => {
        throw new Error("Permission denied: mcp");
      },
    } as unknown as PermissionEngine;
    const mgr = new McpManager([mockServer()], { permission: engine });
    await mgr.connectAll();
    try {
      const echo = mgr.tools().find((t) => t.name === "mcp__mock__echo")!;
      await expect(echo.execute({ text: "hi" })).rejects.toThrow(/denied/i);
    } finally {
      await mgr.closeAll();
    }
  });

  it("tolerates a server that fails to start", async () => {
    const notes: string[] = [];
    const { engine } = allowAll();
    const mgr = new McpManager(
      [{ name: "broken", command: "larb-no-such-binary-xyz" }],
      { permission: engine, onNote: (n) => notes.push(n) },
    );
    await mgr.connectAll();
    expect(mgr.tools()).toHaveLength(0);
    expect(notes.some((n) => n.includes("broken") && n.includes("failed"))).toBe(true);
    await mgr.closeAll();
  });
});

describe("toolName", () => {
  it("namespaces and sanitizes to the provider charset, clamped to 64 chars", () => {
    expect(toolName("github", "create.issue")).toBe("mcp__github__create_issue");
    expect(toolName("a b", "c/d")).toBe("mcp__a_b__c_d");
    expect(toolName("x".repeat(60), "y".repeat(60)).length).toBe(64);
  });
});

describe("buildChildEnv", () => {
  it("expands ${VAR} from the host env and withholds unlisted secrets", () => {
    process.env.LARB_TEST_TOKEN = "s3cr3t";
    try {
      const env = buildChildEnv({ TOKEN: "${LARB_TEST_TOKEN}", LITERAL: "v" });
      expect(env.TOKEN).toBe("s3cr3t");
      expect(env.LITERAL).toBe("v");
      expect(env.LARB_MCP).toBe("1");
      // A host var not referenced/listed is not forwarded.
      expect(env.LARB_TEST_TOKEN).toBeUndefined();
    } finally {
      delete process.env.LARB_TEST_TOKEN;
    }
  });

  it("expands a missing var to empty string", () => {
    const env = buildChildEnv({ X: "${DEFINITELY_MISSING_VAR_XYZ}" });
    expect(env.X).toBe("");
  });
});
