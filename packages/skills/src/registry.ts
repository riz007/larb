import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  cpSync,
  statSync,
} from "node:fs";
import { join, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { larbHome, projectLarbDir } from "@larb/governors";
import { parseManifest, type SkillManifest } from "./manifest.js";
import { verifyTier, type TrustTier } from "./signing.js";

export interface SkillInstance {
  manifest: SkillManifest;
  dir: string;
  tier: TrustTier;
  signer?: string;
  tierReason?: string;
  /** Model-readable instructions (manifest.instructions or SKILL.md body). */
  instructions: string;
}

/** Global skills dir (~/.larb/skills) — shared across projects. */
export function globalSkillsDir(): string {
  const dir = join(larbHome(), "skills");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Per-project skills dir (<project>/.larb/skills). */
export function projectSkillsDir(projectRoot: string): string {
  const dir = join(projectLarbDir(projectRoot), "skills");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadSkill(dir: string): SkillInstance {
  const manifest = parseManifest(JSON.parse(readFileSync(join(dir, "skill.json"), "utf8")));
  const { tier, signer, reason } = verifyTier(dir);
  const skillMd = join(dir, "SKILL.md");
  const instructions =
    manifest.instructions ??
    (existsSync(skillMd) ? readFileSync(skillMd, "utf8") : "");
  return { manifest, dir, tier, signer, tierReason: reason, instructions };
}

/** Load every installed skill from the global and project skills dirs. */
export function loadAllSkills(projectRoot: string): SkillInstance[] {
  const out: SkillInstance[] = [];
  for (const base of [globalSkillsDir(), projectSkillsDir(projectRoot)]) {
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const dir = join(base, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
        if (!existsSync(join(dir, "skill.json"))) continue;
        out.push(loadSkill(dir));
      } catch {
        /* skip unreadable skills */
      }
    }
  }
  return out;
}

/**
 * Install a skill from a local directory. Installing copies files and validates
 * the manifest — it does NOT grant trust. Trust tier is computed at load time
 * from the signature, and capabilities are enforced at run time.
 */
export function installSkill(
  srcDir: string,
  opts: { projectRoot?: string; scope?: "global" | "project" } = {},
): SkillInstance {
  const src = resolve(srcDir);
  if (!existsSync(join(src, "skill.json"))) {
    throw new Error(`No skill.json found in ${src}`);
  }
  const manifest = parseManifest(JSON.parse(readFileSync(join(src, "skill.json"), "utf8")));
  const base =
    opts.scope === "project" && opts.projectRoot
      ? projectSkillsDir(opts.projectRoot)
      : globalSkillsDir();
  const dest = join(base, manifest.name || basename(src));
  cpSync(src, dest, { recursive: true });
  return loadSkill(dest);
}

/** True for sources `installFromUrl` knows how to fetch (https tarball or git). */
export function isRemoteSkillSource(src: string): boolean {
  return (
    /^https:\/\//i.test(src) ||
    /^git\+https:\/\//i.test(src) ||
    /\.git$/i.test(src)
  );
}

/** Find the directory holding skill.json, searching `dir` then one level down. */
export function findSkillRoot(dir: string): string | undefined {
  if (existsSync(join(dir, "skill.json"))) return dir;
  for (const name of readdirSync(dir)) {
    const sub = join(dir, name);
    try {
      if (statSync(sub).isDirectory() && existsSync(join(sub, "skill.json"))) return sub;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/**
 * Install a skill from a remote source (an https tarball or a git URL). This is
 * an explicit, user-initiated CLI action — the agent has no tool that reaches
 * it — so the network fetch is consented to by running the command. Install is
 * still NOT trust: the tier is computed from the signature at load time, and an
 * unsigned remote skill lands as `community` (tightest sandbox, every capability
 * use prompts). The download is staged in a temp dir and removed afterward.
 */
export async function installFromUrl(
  url: string,
  opts: { projectRoot?: string; scope?: "global" | "project" } = {},
): Promise<SkillInstance> {
  if (!isRemoteSkillSource(url)) {
    throw new Error(`Not a remote skill source (need https tarball or git URL): ${url}`);
  }
  const work = mkdtempSync(join(tmpdir(), "larb-skill-dl-"));
  try {
    const fetched = await fetchSkillSource(url, work);
    const root = findSkillRoot(fetched);
    if (!root) throw new Error(`No skill.json found in ${url}`);
    return installSkill(root, opts);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Download/clone a skill source into `work`, returning the extracted directory. */
async function fetchSkillSource(url: string, work: string): Promise<string> {
  const isGit = /^git\+https:\/\//i.test(url) || /\.git$/i.test(url);
  if (isGit) {
    const clean = url.replace(/^git\+/, "");
    const dest = join(work, "clone");
    const r = spawnSync("git", ["clone", "--depth", "1", clean, dest], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git clone failed: ${r.stderr || r.error?.message || "unknown error"}`);
    return dest;
  }

  // https tarball (.tar.gz / .tgz): fetch, then extract with the system tar.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  const archive = join(work, "skill.tgz");
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  const extracted = join(work, "extracted");
  mkdirSync(extracted, { recursive: true });
  const r = spawnSync("tar", ["-xzf", archive, "-C", extracted], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tar extract failed: ${r.stderr || r.error?.message || "unknown error"}`);
  return extracted;
}
