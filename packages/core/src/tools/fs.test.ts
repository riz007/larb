import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileTool, editFileTool } from "./fs.js";
import type { ToolContext } from "./types.js";

let project: string;
let ctx: ToolContext;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "larb-fs-"));
  ctx = {
    projectRoot: project,
    permission: { require: async () => {} },
    audit: { log: () => {} },
  } as unknown as ToolContext;
});

describe("edit_file", () => {
  it("replaces a unique exact match and reports the diff size", async () => {
    writeFileSync(join(project, "a.ts"), "const x = 1;\nconst y = 2;\n");
    const r = await editFileTool.execute(
      { path: "a.ts", old_string: "const y = 2;", new_string: "const y = 3;" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(readFileSync(join(project, "a.ts"), "utf8")).toBe("const x = 1;\nconst y = 3;\n");
  });

  it("fails loudly when old_string is not found (stale context)", async () => {
    writeFileSync(join(project, "a.ts"), "hello\n");
    const r = await editFileTool.execute(
      { path: "a.ts", old_string: "goodbye", new_string: "x" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.content).toContain("not found");
    expect(readFileSync(join(project, "a.ts"), "utf8")).toBe("hello\n"); // untouched
  });

  it("refuses an ambiguous match unless replace_all is set", async () => {
    writeFileSync(join(project, "a.ts"), "foo();\nfoo();\n");
    const r = await editFileTool.execute(
      { path: "a.ts", old_string: "foo();", new_string: "bar();" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.content).toContain("2 places");

    const r2 = await editFileTool.execute(
      { path: "a.ts", old_string: "foo();", new_string: "bar();", replace_all: true },
      ctx,
    );
    expect(r2.ok).toBe(true);
    expect(readFileSync(join(project, "a.ts"), "utf8")).toBe("bar();\nbar();\n");
  });

  it("rejects a missing file, empty old_string, and identical strings", async () => {
    expect((await editFileTool.execute({ path: "no.ts", old_string: "a", new_string: "b" }, ctx)).ok).toBe(false);
    writeFileSync(join(project, "a.ts"), "x");
    expect((await editFileTool.execute({ path: "a.ts", old_string: "", new_string: "b" }, ctx)).ok).toBe(false);
    expect((await editFileTool.execute({ path: "a.ts", old_string: "x", new_string: "x" }, ctx)).ok).toBe(false);
  });

  it("refuses paths outside the project root", async () => {
    await expect(
      editFileTool.execute({ path: "../escape.ts", old_string: "a", new_string: "b" }, ctx),
    ).rejects.toThrow(/escapes/);
  });
});

describe("read_file ranged reads", () => {
  it("returns the requested line window with a range marker", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
    writeFileSync(join(project, "big.txt"), lines);
    const r = await readFileTool.execute({ path: "big.txt", offset: 10, limit: 3 }, ctx);
    expect(r.ok).toBe(true);
    expect(r.content).toContain("line 10\nline 11\nline 12");
    expect(r.content).toContain("lines 10–12 of 50");
    expect(r.content).not.toContain("line 13");
  });

  it("still reads whole files when no range is given", async () => {
    writeFileSync(join(project, "s.txt"), "a\nb");
    const r = await readFileTool.execute({ path: "s.txt" }, ctx);
    expect(r.content).toBe("a\nb");
  });
});
