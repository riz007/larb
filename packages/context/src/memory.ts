import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { projectLarbDir } from "@larb/governors";

const MAX_MEMORY_CONTEXT_BYTES = 16 * 1024;

/**
 * Local, inspectable, markdown-on-disk memory, per-project.
 *
 * Stored as plain .md files under <project>/.larb/memory so there is no hidden
 * state — the user can read, edit, or delete any of it. The per-project scope
 * guard is the directory boundary itself.
 */
export class ProjectMemory {
  private readonly dir: string;

  constructor(projectRoot: string) {
    this.dir = join(projectLarbDir(projectRoot), "memory");
    mkdirSync(this.dir, { recursive: true });
  }

  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  }

  read(name: string): string | undefined {
    const file = this.fileFor(name);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  }

  remember(name: string, content: string): void {
    writeFileSync(this.fileFor(name), content, "utf8");
  }

  /** Absolute path a memory name maps to (for permission scoping / display). */
  pathFor(name: string): string {
    return this.fileFor(name);
  }

  /** Concatenate memory for context injection, bounded in size. */
  load(): string {
    const parts: string[] = [];
    let budget = MAX_MEMORY_CONTEXT_BYTES;
    for (const name of this.list()) {
      const content = this.read(name) ?? "";
      const block = `## ${name}\n${content}\n`;
      if (block.length > budget) break;
      budget -= block.length;
      parts.push(block);
    }
    return parts.join("\n");
  }

  private fileFor(name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.dir, `${safe}.md`);
  }
}
