import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import type { PermissionEngine } from "@larb/governors";
import type { Sandbox } from "@larb/sandbox";
import { pathDeclared } from "./manifest.js";
import type { SkillInstance } from "./registry.js";

const HOST_PATH = fileURLToPath(new URL("../host/skill-host.mjs", import.meta.url));
const INVOKE_TIMEOUT_MS = 60_000;

export interface BrokerDeps {
  projectRoot: string;
  permission: PermissionEngine;
  sandbox: Sandbox;
}

export interface PreparedSkillTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  tier: string;
  execute(input: Record<string, unknown>): Promise<{ ok: boolean; content: string; summary: string }>;
  onNote?: (note: string) => void;
}

/** Env passed to the isolated skill child — host secrets stripped. */
function scrubbedEnv(): NodeJS.ProcessEnv {
  const allow = ["PATH", "HOME", "LANG", "TMPDIR", "TERM", "USER", "SHELL"];
  const env: NodeJS.ProcessEnv = { LARB_SKILL_SANDBOX: "1" };
  for (const k of allow) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

/**
 * Runs a skill's plugin tool in an isolated child process and brokers every
 * capability request against BOTH the skill's manifest and the permission
 * engine. The skill never shares the host's memory or environment, and can
 * only touch resources it declared and the user approved.
 */
export class SkillRunner {
  constructor(
    private readonly skill: SkillInstance,
    private readonly deps: BrokerDeps,
    private readonly onNote?: (note: string) => void,
  ) {}

  invoke(toolName: string, input: Record<string, unknown>): Promise<{ ok: boolean; content: string }> {
    const entry = resolve(this.skill.dir, this.skill.manifest.plugin?.entry ?? "");
    return new Promise((resolveResult) => {
      const child = fork(HOST_PATH, [entry], {
        cwd: this.deps.projectRoot,
        env: scrubbedEnv(),
        silent: true,
        execArgv: [],
      });

      let settled = false;
      const finish = (r: { ok: boolean; content: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        resolveResult(r);
      };

      const timer = setTimeout(
        () => finish({ ok: false, content: "Skill timed out." }),
        INVOKE_TIMEOUT_MS,
      );

      child.on("message", async (msg: HostMessage) => {
        if (msg.type === "cap") {
          const res = await this.handleCapability(msg.op, msg.args);
          send(child, { type: "cap-result", id: msg.id, ...res });
        } else if (msg.type === "result") {
          finish({ ok: msg.ok, content: msg.content });
        } else if (msg.type === "error") {
          finish({ ok: false, content: `Skill error: ${msg.message}` });
        } else if (msg.type === "log") {
          this.onNote?.(`[skill ${this.skill.manifest.name}] ${msg.message}`);
        }
      });
      child.on("error", (err) => finish({ ok: false, content: `Skill failed to start: ${err.message}` }));
      child.on("exit", (code) => {
        if (!settled) finish({ ok: false, content: `Skill exited early (code ${code}).` });
      });

      send(child, { type: "invoke", tool: toolName, input });
    });
  }

  private async handleCapability(
    op: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const { manifest } = this.skill;
    const root = resolve(this.deps.projectRoot);
    const tierNote = `skill "${manifest.name}" (${this.skill.tier})`;

    try {
      switch (op) {
        case "readFile": {
          const rel = String(args.path ?? "");
          const abs = this.inside(root, rel);
          if (!pathDeclared(manifest.capabilities.fs?.read, rel))
            return deny(`${tierNote} did not declare fs.read for ${rel}`);
          await this.deps.permission.require({
            capability: "fs.read",
            path: abs,
            reason: `${tierNote} reads ${rel}`,
          });
          if (!existsSync(abs)) return { ok: false, error: "file not found" };
          return { ok: true, data: readFileSync(abs, "utf8") };
        }
        case "writeFile": {
          const rel = String(args.path ?? "");
          const abs = this.inside(root, rel);
          if (!pathDeclared(manifest.capabilities.fs?.write, rel))
            return deny(`${tierNote} did not declare fs.write for ${rel}`);
          await this.deps.permission.require({
            capability: "fs.write",
            path: abs,
            reason: `${tierNote} writes ${rel}`,
          });
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, String(args.content ?? ""), "utf8");
          return { ok: true };
        }
        case "exec": {
          const command = String(args.command ?? "");
          if (!manifest.capabilities.exec)
            return deny(`${tierNote} did not declare the exec capability`);
          await this.deps.permission.require({
            capability: "exec",
            path: root,
            command,
            reason: `${tierNote} runs: ${command}`,
          });
          const res = await this.deps.sandbox.run(command);
          return { ok: true, data: { code: res.code, stdout: res.stdout, stderr: res.stderr } };
        }
        case "fetch": {
          const url = String(args.url ?? "");
          const host = safeHost(url);
          if (!host || !(manifest.capabilities.net ?? []).includes(host))
            return deny(`${tierNote} did not declare net access to ${host ?? url}`);
          await this.deps.permission.require({
            capability: "net",
            host,
            reason: `${tierNote} fetches ${url}`,
          });
          const r = await fetch(url, (args.init as RequestInit) ?? {});
          return { ok: true, data: { status: r.status, body: (await r.text()).slice(0, 256 * 1024) } };
        }
        default:
          return deny(`unknown capability: ${op}`);
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private inside(root: string, p: string): string {
    const abs = resolve(root, p);
    if (abs !== root && !abs.startsWith(root + sep)) {
      throw new Error(`path escapes project root: ${p}`);
    }
    return abs;
  }
}

/** Adapt installed skills' plugin tools into prepared tools for the registry. */
export function loadSkillTools(
  skills: SkillInstance[],
  deps: BrokerDeps,
  onNote?: (note: string) => void,
): PreparedSkillTool[] {
  const tools: PreparedSkillTool[] = [];
  for (const skill of skills) {
    if (!skill.manifest.plugin) continue;
    const runner = new SkillRunner(skill, deps, onNote);
    for (const def of skill.manifest.plugin.tools) {
      tools.push({
        name: `skill__${skill.manifest.name}__${def.name}`,
        description: `[skill: ${skill.manifest.name} · ${skill.tier}] ${def.description}`,
        inputSchema: def.inputSchema,
        tier: skill.tier,
        execute: async (input) => {
          const r = await runner.invoke(def.name, input);
          return {
            ok: r.ok,
            content: r.content,
            summary: `skill ${skill.manifest.name}.${def.name} → ${r.ok ? "ok" : "fail"}`,
          };
        },
      });
    }
  }
  return tools;
}

interface BaseMsg {
  type: string;
}
type HostMessage =
  | { type: "cap"; id: number; op: string; args: Record<string, unknown> }
  | { type: "result"; ok: boolean; content: string }
  | { type: "error"; message: string }
  | { type: "log"; message: string };

function send(child: ChildProcess, msg: BaseMsg & Record<string, unknown>): void {
  child.send(msg);
}

function deny(reason: string): { ok: false; error: string } {
  return { ok: false, error: `Capability denied: ${reason}` };
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
