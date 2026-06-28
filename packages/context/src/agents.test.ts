import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentInstructions } from "./agents.js";

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "larb-agents-"));
});

describe("loadAgentInstructions", () => {
  it("returns empty string when no instruction files exist", () => {
    expect(loadAgentInstructions(project)).toBe("");
  });

  it("reads root AGENTS.md under a labeled header", () => {
    writeFileSync(join(project, "AGENTS.md"), "Use pnpm. Run `pnpm test` before done.");
    const out = loadAgentInstructions(project);
    expect(out).toContain("### AGENTS.md");
    expect(out).toContain("Use pnpm.");
  });

  it("appends .larb/AGENTS.md after the root file", () => {
    writeFileSync(join(project, "AGENTS.md"), "root guidance");
    mkdirSync(join(project, ".larb"), { recursive: true });
    writeFileSync(join(project, ".larb", "AGENTS.md"), "larb-specific guidance");
    const out = loadAgentInstructions(project);
    expect(out.indexOf("root guidance")).toBeLessThan(out.indexOf("larb-specific guidance"));
    expect(out).toContain(join(".larb", "AGENTS.md"));
  });

  it("bounds the injected size (truncates oversized files)", () => {
    writeFileSync(join(project, "AGENTS.md"), "x".repeat(40 * 1024));
    const out = loadAgentInstructions(project);
    expect(out.length).toBeLessThan(20 * 1024);
    expect(out).toContain("…(truncated)");
  });

  it("ignores an empty AGENTS.md", () => {
    writeFileSync(join(project, "AGENTS.md"), "   \n  ");
    expect(loadAgentInstructions(project)).toBe("");
  });
});
