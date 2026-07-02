import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectMemory } from "@larb/context";
import { rememberTool } from "./memory.js";
import type { ToolContext } from "./types.js";

let project: string;
let memory: ProjectMemory;
let ctx: ToolContext;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "larb-mem-"));
  memory = new ProjectMemory(project);
  ctx = {
    projectRoot: project,
    permission: { require: async () => {} },
    audit: { log: () => {} },
    memory,
  } as unknown as ToolContext;
});

describe("remember tool", () => {
  it("persists a note that future sessions load into context", async () => {
    const r = await rememberTool.execute(
      { name: "build-quirks", content: "Tests need LARB_HOME set to a tmp dir." },
      ctx,
    );
    expect(r.ok).toBe(true);
    // A fresh ProjectMemory (≈ next session) sees it.
    const next = new ProjectMemory(project);
    expect(next.load()).toContain("Tests need LARB_HOME set");
    expect(next.list()).toContain("build-quirks");
  });

  it("overwrites an existing note with the same name", async () => {
    await rememberTool.execute({ name: "n", content: "old fact" }, ctx);
    await rememberTool.execute({ name: "n", content: "new fact" }, ctx);
    expect(new ProjectMemory(project).read("n")).toBe("new fact");
  });

  it("rejects empty input and oversized notes", async () => {
    expect((await rememberTool.execute({ name: "", content: "x" }, ctx)).ok).toBe(false);
    expect((await rememberTool.execute({ name: "n", content: "" }, ctx)).ok).toBe(false);
    expect(
      (await rememberTool.execute({ name: "n", content: "x".repeat(9000) }, ctx)).ok,
    ).toBe(false);
  });

  it("gates the write behind the permission engine", async () => {
    const denying = {
      ...ctx,
      permission: {
        require: async () => {
          throw new Error("Permission denied: fs.write");
        },
      },
    } as unknown as ToolContext;
    await expect(
      rememberTool.execute({ name: "n", content: "x" }, denying),
    ).rejects.toThrow(/denied/i);
  });
});
