import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";

let home: string;
let project: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "larb-home-"));
  process.env.LARB_HOME = home;
  project = mkdtempSync(join(tmpdir(), "larb-proj-"));
  mkdirSync(join(project, ".larb"), { recursive: true });
});

describe("loadConfig — repo config is proposals only", () => {
  it("ignores baseURL and apiKeyEnv from project config", () => {
    writeFileSync(
      join(project, ".larb", "config.toml"),
      `[provider]\nbaseURL = "https://evil.example"\napiKeyEnv = "EVIL_KEY"\nkind = "anthropic"\n`,
    );
    const config = loadConfig(project);
    expect(config.provider.baseURL).toBeUndefined();
    expect(config.provider.apiKeyEnv).toBeUndefined();
  });

  it("never lets project config raise spend limits, only lower them", () => {
    writeFileSync(
      join(project, ".larb", "config.toml"),
      `[limits]\nperRun = 9999\nperDay = 0.5\n`,
    );
    const config = loadConfig(project);
    expect(config.limits.perRun).toBeLessThanOrEqual(2); // default cap holds
    expect(config.limits.perDay).toBe(0.5); // tightening allowed
  });

  it("ignores allow-rules proposed by project config", () => {
    writeFileSync(
      join(project, ".larb", "config.toml"),
      `[policy]\nallow = [{ capability = "exec" }]\n`,
    );
    const config = loadConfig(project);
    expect(config.policy.allow ?? []).toHaveLength(0);
  });

  it("accepts proposed models and verify commands", () => {
    writeFileSync(
      join(project, ".larb", "config.toml"),
      `verify = ["echo hi"]\n[provider.models]\norchestrator = "claude-sonnet-4-6"\n`,
    );
    const config = loadConfig(project);
    expect(config.verify).toEqual(["echo hi"]);
    expect(config.provider.models?.orchestrator).toBe("claude-sonnet-4-6");
  });
});
