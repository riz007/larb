import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, relative, dirname, join, sep } from "node:path";
import { createPatch } from "diff";
import type { Tool, ToolContext, ToolResult } from "./types.js";

const MAX_READ_BYTES = 200 * 1024;
const SKIP = new Set([
  "node_modules",
  ".git",
  ".larb",
  "dist",
  "build",
  ".next",
  "coverage",
]);

/** Resolve a model-supplied path and refuse anything outside the project root. */
function resolveInside(projectRoot: string, p: string): string {
  const root = resolve(projectRoot);
  const abs = resolve(root, p);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`Path escapes project root: ${p}`);
  }
  return abs;
}

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read a UTF-8 text file within the project. Returns its contents.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Project-relative path" } },
    required: ["path"],
  },
  async execute(input, ctx): Promise<ToolResult> {
    const rel = String(input.path ?? "");
    const abs = resolveInside(ctx.projectRoot, rel);
    await ctx.permission.require({
      capability: "fs.read",
      path: abs,
      reason: `read ${rel}`,
    });
    if (!existsSync(abs)) return fail(`File not found: ${rel}`);
    const text = readFileSync(abs, "utf8");
    const body =
      text.length > MAX_READ_BYTES
        ? text.slice(0, MAX_READ_BYTES) + "\n…[truncated]"
        : text;
    return { ok: true, content: body, summary: `read ${rel} (${text.length} bytes)` };
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Create or overwrite a text file within the project. Shows a diff and " +
    "requires explicit approval before writing.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Project-relative path" },
      content: { type: "string", description: "Full new file contents" },
    },
    required: ["path", "content"],
  },
  async execute(input, ctx): Promise<ToolResult> {
    const rel = String(input.path ?? "");
    const content = String(input.content ?? "");
    const abs = resolveInside(ctx.projectRoot, rel);
    const before = existsSync(abs) ? readFileSync(abs, "utf8") : "";

    const patch = createPatch(rel, before, content);
    const { added, removed } = countChanges(patch);
    ctx.onDiff?.(rel, patch);

    await ctx.permission.require({
      capability: "fs.write",
      path: abs,
      reason: `write ${rel} (+${added}/-${removed})`,
    });

    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    return {
      ok: true,
      content: `Wrote ${rel} (+${added}/-${removed} lines).`,
      summary: `wrote ${rel} (+${added}/-${removed})`,
    };
  },
};

export const listFilesTool: Tool = {
  name: "list_files",
  description: "List files under a project directory (recursive, capped).",
  inputSchema: {
    type: "object",
    properties: {
      dir: { type: "string", description: "Project-relative dir (default root)" },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const rel = String(input.dir ?? ".");
    const abs = resolveInside(ctx.projectRoot, rel);
    await ctx.permission.require({
      capability: "fs.read",
      path: abs,
      reason: `list ${rel}`,
    });
    const files: string[] = [];
    walk(abs, ctx.projectRoot, files, 0);
    files.sort();
    const shown = files.slice(0, 500);
    return {
      ok: true,
      content: shown.join("\n") + (files.length > shown.length ? `\n…(${files.length - shown.length} more)` : ""),
      summary: `listed ${files.length} files under ${rel}`,
    };
  },
};

export const searchTextTool: Tool = {
  name: "search_text",
  description: "Search project files for a regular expression. Returns file:line matches.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "JavaScript regular expression" },
    },
    required: ["query"],
  },
  async execute(input, ctx): Promise<ToolResult> {
    const query = String(input.query ?? "");
    await ctx.permission.require({
      capability: "fs.read",
      path: resolve(ctx.projectRoot),
      reason: `search /${query}/`,
    });
    let re: RegExp;
    try {
      re = new RegExp(query);
    } catch (e) {
      return fail(`Invalid regex: ${(e as Error).message}`);
    }
    const files: string[] = [];
    walk(resolve(ctx.projectRoot), ctx.projectRoot, files, 0);
    const matches: string[] = [];
    for (const rel of files) {
      if (matches.length >= 200) break;
      const abs = join(ctx.projectRoot, rel);
      let text: string;
      try {
        if (statSync(abs).size > MAX_READ_BYTES) continue;
        text = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i] ?? "")) {
          matches.push(`${rel}:${i + 1}: ${(lines[i] ?? "").trim().slice(0, 200)}`);
          if (matches.length >= 200) break;
        }
      }
    }
    return {
      ok: true,
      content: matches.length ? matches.join("\n") : "No matches.",
      summary: `search /${query}/ → ${matches.length} matches`,
    };
  },
};

function walk(abs: string, root: string, out: string[], depth: number): void {
  if (depth > 12 || out.length > 5000) return;
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const child = join(abs, e.name);
    if (e.isDirectory()) walk(child, root, out, depth + 1);
    else if (e.isFile()) out.push(relative(root, child));
  }
}

function countChanges(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

function fail(message: string): ToolResult {
  return { ok: false, content: `Error: ${message}`, summary: message };
}
