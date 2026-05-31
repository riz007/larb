import {
  readFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  cpSync,
  statSync,
} from "node:fs";
import { join, basename, resolve } from "node:path";
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
