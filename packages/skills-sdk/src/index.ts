/**
 * Public SDK for authoring Larb skills.
 *
 * A skill plugin is a plain ES module that exports `tools` — a map of tool
 * handlers. At run time each handler receives a brokered {@link SkillContext}:
 * every fs/exec/net call goes through the host, is checked against the skill's
 * manifest, and requires the user's permission. A skill can NEVER reach the
 * host directly or read its environment.
 */

export interface SkillContext {
  /** Read a project file the manifest declared under capabilities.fs.read. */
  readFile(path: string): Promise<string>;
  /** Write a project file the manifest declared under capabilities.fs.write. */
  writeFile(path: string, content: string): Promise<void>;
  /** Run a shell command (requires capabilities.exec). Runs in the sandbox. */
  exec(command: string): Promise<{ code: number | null; stdout: string; stderr: string }>;
  /** Fetch a URL whose host is declared under capabilities.net. */
  fetch(url: string, init?: RequestInit): Promise<{ status: number; body: string }>;
  /** Emit an informational note to the user. */
  log(message: string): void;
}

export interface SkillToolResult {
  ok?: boolean;
  content: string;
}

export type SkillToolHandler = (
  input: Record<string, unknown>,
  ctx: SkillContext,
) => Promise<SkillToolResult> | SkillToolResult;

export type SkillTools = Record<string, SkillToolHandler>;

/** Identity helper that gives authors type-checking on their tool map. */
export function defineTools(tools: SkillTools): SkillTools {
  return tools;
}
