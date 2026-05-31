import {
  readdirSync,
  readFileSync,
  statSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, extname } from "node:path";
import { projectLarbDir } from "@larb/governors";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".larb",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  "coverage",
  ".cache",
  "vendor",
  "__pycache__",
]);

const MAX_FILE_BYTES = 256 * 1024;

interface FileEntry {
  mtimeMs: number;
  lines: number;
  language: string;
  symbols: string[];
}

type MapCache = Record<string, FileEntry>;

/** Per-language top-level symbol extractors (lightweight, regex-based). */
const SYMBOL_PATTERNS: Record<string, RegExp[]> = {
  ts: [
    /^export\s+(?:async\s+)?function\s+(\w+)/,
    /^export\s+(?:abstract\s+)?class\s+(\w+)/,
    /^export\s+interface\s+(\w+)/,
    /^export\s+type\s+(\w+)/,
    /^export\s+(?:const|let|var)\s+(\w+)/,
    /^(?:async\s+)?function\s+(\w+)/,
    /^class\s+(\w+)/,
  ],
  py: [/^def\s+(\w+)/, /^async\s+def\s+(\w+)/, /^class\s+(\w+)/],
  go: [/^func\s+(?:\([^)]*\)\s+)?(\w+)/, /^type\s+(\w+)/],
  rs: [
    /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
    /^(?:pub\s+)?struct\s+(\w+)/,
    /^(?:pub\s+)?enum\s+(\w+)/,
    /^(?:pub\s+)?trait\s+(\w+)/,
  ],
};

const EXT_LANG: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "ts",
  ".js": "ts",
  ".jsx": "ts",
  ".mjs": "ts",
  ".cjs": "ts",
  ".py": "py",
  ".go": "go",
  ".rs": "rs",
};

export interface RepoMap {
  root: string;
  fileCount: number;
  files: Array<{ path: string; language: string; lines: number; symbols: string[] }>;
}

/**
 * Incremental structural index of the codebase.
 *
 * Walks the project, extracts top-level symbols per file, and caches results in
 * <project>/.larb/repomap.json keyed by mtime so re-indexing only touches files
 * that changed. Used for cross-file reasoning and architecture-aware planning.
 */
export function buildRepoMap(projectRoot: string): RepoMap {
  const root = resolve(projectRoot);
  const cacheFile = join(projectLarbDir(root), "repomap.json");
  const cache: MapCache = loadCache(cacheFile);
  const next: MapCache = {};
  const files: RepoMap["files"] = [];

  for (const abs of walk(root)) {
    const lang = EXT_LANG[extname(abs)];
    if (!lang) continue;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.size > MAX_FILE_BYTES) continue;

    const rel = relative(root, abs);
    const cached = cache[rel];
    let entry: FileEntry;
    if (cached && cached.mtimeMs === st.mtimeMs) {
      entry = cached;
    } else {
      entry = indexFile(abs, lang, st.mtimeMs);
    }
    next[rel] = entry;
    files.push({ path: rel, language: entry.language, lines: entry.lines, symbols: entry.symbols });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  saveCache(cacheFile, next);
  return { root, fileCount: files.length, files };
}

/** Render a compact textual map for the model context. */
export function renderRepoMap(map: RepoMap, maxFiles = 200): string {
  const lines: string[] = [`Repo map: ${map.fileCount} indexed files`];
  for (const f of map.files.slice(0, maxFiles)) {
    const syms = f.symbols.slice(0, 12).join(", ");
    lines.push(`  ${f.path} (${f.lines} lines)${syms ? ` — ${syms}` : ""}`);
  }
  if (map.files.length > maxFiles) {
    lines.push(`  …and ${map.files.length - maxFiles} more files`);
  }
  return lines.join("\n");
}

function indexFile(abs: string, lang: string, mtimeMs: number): FileEntry {
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return { mtimeMs, lines: 0, language: lang, symbols: [] };
  }
  const patterns = SYMBOL_PATTERNS[lang] ?? [];
  const rows = text.split("\n");
  const symbols = new Set<string>();
  for (const raw of rows) {
    const line = raw.trim();
    for (const re of patterns) {
      const m = re.exec(line);
      if (m && m[1]) symbols.add(m[1]);
    }
  }
  return { mtimeMs, lines: rows.length, language: lang, symbols: [...symbols] };
}

function* walk(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") {
      if (SKIP_DIRS.has(e.name)) continue;
    }
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(join(dir, e.name));
    } else if (e.isFile()) {
      yield join(dir, e.name);
    }
  }
}

function loadCache(file: string): MapCache {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as MapCache;
  } catch {
    return {};
  }
}

function saveCache(file: string, cache: MapCache): void {
  try {
    writeFileSync(file, JSON.stringify(cache), "utf8");
  } catch {
    /* cache is best-effort */
  }
}
