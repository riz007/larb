import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PermissionEngine } from "@larb/governors";
import { Sandbox } from "@larb/sandbox";
import { isRemoteSkillSource, findSkillRoot, installFromUrl } from "./registry.js";

beforeAll(() => {
  process.env.LARB_HOME = mkdtempSync(join(tmpdir(), "larb-home-"));
});

function makeSkill(capabilities: object, plugin: string): string {
  const dir = mkdtempSync(join(tmpdir(), "larb-skill-"));
  const manifest = {
    name: "test-skill",
    version: "0.1.0",
    description: "test",
    plugin: { entry: "plugin.mjs", tools: [{ name: "act", description: "act", inputSchema: { type: "object" } }] },
    capabilities,
  };
  writeFileSync(join(dir, "skill.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "plugin.mjs"), plugin);
  return dir;
}

const allowAll = (projectRoot: string) =>
  new PermissionEngine({ projectRoot, approver: async () => "always" });

describe("signing + trust tier", () => {
  it("treats unsigned skills as community", async () => {
    const { verifyTier } = await import("./signing.js");
    const dir = makeSkill({}, "export const tools = {};");
    expect(verifyTier(dir).tier).toBe("community");
  });

  it("verifies a signed skill against a trusted key and detects tampering", async () => {
    const { generateKeypair, signSkill, addTrustedKey, verifyTier } = await import("./signing.js");
    const dir = makeSkill({}, "export const tools = {};");
    const { publicKeyPem, privateKeyPem } = generateKeypair();
    signSkill(dir, privateKeyPem, publicKeyPem);

    // Signed but signer not yet trusted → community.
    expect(verifyTier(dir).tier).toBe("community");

    addTrustedKey({ name: "me", publicKeyPem, tier: "verified" });
    expect(verifyTier(dir).tier).toBe("verified");

    // Tamper with the code after signing → drops back to community.
    writeFileSync(join(dir, "plugin.mjs"), "export const tools = {}; // changed");
    const after = verifyTier(dir);
    expect(after.tier).toBe("community");
    expect(after.reason).toMatch(/content changed/);
  });
});

describe("broker manifest enforcement (the headline guarantee)", () => {
  it("denies a capability the manifest did not declare, even if the user would allow", async () => {
    const { loadSkill } = await import("./registry.js");
    const { SkillRunner } = await import("./broker.js");
    const dir = makeSkill(
      {}, // declares NO capabilities
      `export const tools = { act: async (input, ctx) => {
         try { const c = await ctx.readFile("secret.txt"); return { ok: true, content: c }; }
         catch (e) { return { ok: false, content: "blocked: " + e.message }; }
       } };`,
    );
    writeFileSync(join(dir, "secret.txt"), "TOP SECRET");
    const skill = loadSkill(dir);
    const runner = new SkillRunner(skill, { projectRoot: dir, permission: allowAll(dir), sandbox: new Sandbox({ projectRoot: dir }) });
    const result = await runner.invoke("act", {});
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/did not declare fs\.read|blocked/);
    expect(result.content).not.toContain("TOP SECRET");
  }, 20000);

  it("allows a declared capability through the broker", async () => {
    const { loadSkill } = await import("./registry.js");
    const { SkillRunner } = await import("./broker.js");
    const dir = makeSkill(
      { fs: { read: ["secret.txt"] } },
      `export const tools = { act: async (input, ctx) => {
         const c = await ctx.readFile("secret.txt"); return { ok: true, content: c };
       } };`,
    );
    writeFileSync(join(dir, "secret.txt"), "declared-data");
    const skill = loadSkill(dir);
    const runner = new SkillRunner(skill, { projectRoot: dir, permission: allowAll(dir), sandbox: new Sandbox({ projectRoot: dir }) });
    const result = await runner.invoke("act", {});
    expect(result.ok).toBe(true);
    expect(result.content).toContain("declared-data");
  }, 20000);
});

describe("remote skill install", () => {
  it("classifies https tarballs and git URLs as remote, local paths as not", () => {
    expect(isRemoteSkillSource("https://example.com/skill.tar.gz")).toBe(true);
    expect(isRemoteSkillSource("git+https://github.com/x/y.git")).toBe(true);
    expect(isRemoteSkillSource("https://github.com/x/y.git")).toBe(true);
    expect(isRemoteSkillSource("./local/skill")).toBe(false);
    expect(isRemoteSkillSource("/abs/path")).toBe(false);
  });

  it("finds skill.json directly or one level down (tarball top folder)", () => {
    const root = mkdtempSync(join(tmpdir(), "larb-find-"));
    const nested = join(root, "my-skill-1.0.0");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "skill.json"), "{}");
    expect(findSkillRoot(root)).toBe(nested);
    expect(findSkillRoot(nested)).toBe(nested);
    const empty = mkdtempSync(join(tmpdir(), "larb-empty-"));
    expect(findSkillRoot(empty)).toBeUndefined();
  });

  it("rejects a non-remote source", async () => {
    await expect(installFromUrl("./local/skill")).rejects.toThrow(/remote skill source/i);
  });
});
