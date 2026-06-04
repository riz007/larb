import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  loadAllSkills,
  installSkill,
  installFromUrl,
  isRemoteSkillSource,
  loadSkill,
  verifyTier,
  contentHash,
  generateKeypair,
  signSkill,
  addTrustedKey,
  type SkillInstance,
} from "@larb/skills";

/** `larb skill <subcommand>` — author, install, inspect, and sign skills. */
export function skillCommand(projectRoot: string, args: string[]): void {
  const [sub, ...rest] = args;
  switch (sub) {
    case "list":
      return list(projectRoot);
    case "init":
      return init(rest);
    case "install":
      return install(projectRoot, rest);
    case "verify":
      return verify(rest);
    case "keygen":
      return keygen(rest);
    case "sign":
      return sign(rest);
    case "trust-key":
      return trustKey(rest);
    default:
      console.log(SKILL_HELP);
  }
}

const SKILL_HELP = `larb skill — governed extensibility

  larb skill list                       List installed skills + trust tier
  larb skill init <dir>                 Scaffold a new skill
  larb skill install <dir|url|git> [--project]  Install a skill (copy/download; does not grant trust)
  larb skill verify <dir>               Show manifest, content hash, and trust tier
  larb skill keygen [--name <n>]        Generate an ed25519 signing keypair
  larb skill sign <dir> --key <pem> --pub <pem>   Sign a skill
  larb skill trust-key --pub <pem> --name <n> [--tier verified|first-party]
`;

function list(projectRoot: string): void {
  const skills = loadAllSkills(projectRoot);
  if (!skills.length) {
    console.log("No skills installed. Try `larb skill init my-skill`.");
    return;
  }
  for (const s of skills) {
    const tools = s.manifest.plugin?.tools.length ?? 0;
    console.log(
      `${s.manifest.name}@${s.manifest.version}  [${s.tier}${s.signer ? ` · ${s.signer}` : ""}]  ${tools} tool(s)`,
    );
    console.log(`  ${s.manifest.description}`);
    console.log(`  ${s.dir}`);
  }
}

function init(args: string[]): void {
  const dir = resolve(args[0] ?? "");
  if (!args[0]) return fail("Usage: larb skill init <dir>");
  if (existsSync(join(dir, "skill.json"))) return fail(`A skill already exists at ${dir}`);
  const name = args[0].split("/").pop()!.replace(/[^a-z0-9-]/g, "-");
  mkdirSync(dir, { recursive: true });

  const manifest = {
    name,
    version: "0.1.0",
    description: "A Larb skill.",
    plugin: {
      entry: "plugin.mjs",
      tools: [
        {
          name: "greet",
          description: "Return a friendly greeting.",
          inputSchema: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      ],
    },
    capabilities: {
      // Declare only what the skill needs; the broker enforces exactly this.
      // fs: { read: ["src/"], write: [] },
      // net: ["api.example.com"],
      // exec: false,
    },
  };
  writeFileSync(join(dir, "skill.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(dir, "SKILL.md"), SKILL_MD_TEMPLATE(name));
  writeFileSync(join(dir, "plugin.mjs"), PLUGIN_TEMPLATE);
  console.log(`Scaffolded skill "${name}" at ${dir}`);
  console.log("Edit skill.json (capabilities!) and plugin.mjs, then `larb skill install`.");
}

function install(projectRoot: string, args: string[]): void {
  const src = args.find((a) => !a.startsWith("--"));
  if (!src) return fail("Usage: larb skill install <dir|https-url|git-url> [--project]");
  const scope = args.includes("--project") ? "project" : "global";

  if (isRemoteSkillSource(src)) {
    console.log(`Fetching skill from ${src} …`);
    installFromUrl(src, { projectRoot, scope })
      .then((skill) => reportInstalled(scope, skill))
      .catch((err) => fail(`Install failed: ${(err as Error).message}`));
    return;
  }
  reportInstalled(scope, installSkill(src, { projectRoot, scope }));
}

function reportInstalled(scope: string, skill: SkillInstance): void {
  console.log(`Installed "${skill.manifest.name}" (${scope}, tier: ${skill.tier}).`);
  if (skill.tier === "community") {
    console.log("⚠ Community tier: unsigned/untrusted. It runs in the tightest");
    console.log("  sandbox and every capability use will ask for your approval.");
  }
}

function verify(args: string[]): void {
  const dir = resolve(args[0] ?? "");
  if (!args[0]) return fail("Usage: larb skill verify <dir>");
  const skill = loadSkill(dir);
  const { tier, signer, reason } = verifyTier(dir);
  console.log(`name:        ${skill.manifest.name}@${skill.manifest.version}`);
  console.log(`description: ${skill.manifest.description}`);
  console.log(`content hash: ${contentHash(dir)}`);
  console.log(`trust tier:  ${tier}${signer ? ` (signed by ${signer})` : ""}${reason ? ` — ${reason}` : ""}`);
  console.log(`capabilities: ${JSON.stringify(skill.manifest.capabilities)}`);
  console.log(`tools:       ${(skill.manifest.plugin?.tools ?? []).map((t) => t.name).join(", ") || "(none)"}`);
}

function keygen(args: string[]): void {
  const name = flag(args, "--name") ?? "larb-skill-key";
  const { publicKeyPem, privateKeyPem } = generateKeypair();
  writeFileSync(`${name}.key.pem`, privateKeyPem);
  writeFileSync(`${name}.pub.pem`, publicKeyPem);
  console.log(`Wrote ${name}.key.pem (PRIVATE — keep secret) and ${name}.pub.pem.`);
}

function sign(args: string[]): void {
  const dir = resolve(args.find((a) => !a.startsWith("--")) ?? "");
  const keyFile = flag(args, "--key");
  const pubFile = flag(args, "--pub");
  if (!dir || !keyFile || !pubFile)
    return fail("Usage: larb skill sign <dir> --key <priv.pem> --pub <pub.pem>");
  const sig = signSkill(dir, readFileSync(keyFile, "utf8"), readFileSync(pubFile, "utf8"));
  console.log(`Signed. Content hash: ${sig.hash}`);
  console.log("Wrote larb.sig. Recipients must trust your public key (`larb skill trust-key`).");
}

function trustKey(args: string[]): void {
  const pubFile = flag(args, "--pub");
  const name = flag(args, "--name");
  const tier = (flag(args, "--tier") ?? "verified") as "verified" | "first-party";
  if (!pubFile || !name) return fail("Usage: larb skill trust-key --pub <pub.pem> --name <n> [--tier]");
  addTrustedKey({ name, publicKeyPem: readFileSync(pubFile, "utf8"), tier });
  console.log(`Trusted key "${name}" added at tier "${tier}".`);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function fail(msg: string): void {
  console.error(msg);
  process.exitCode = 1;
}

const SKILL_MD_TEMPLATE = (name: string): string =>
  `# ${name}

Describe here, in plain language, what this skill does and when the agent
should use it. This text is injected into the model's context as instructions.

## When to use
- ...

## Notes
This skill's code runs in an isolated process and may only use the capabilities
declared in \`skill.json\`.
`;

const PLUGIN_TEMPLATE = `// A Larb skill plugin. Capabilities are brokered by the host according to
// skill.json — this code cannot touch anything it did not declare, and never
// sees host environment variables or secrets.
//
// import { defineTools } from "@larb/skills-sdk"; // for types (optional)

export const tools = {
  greet: async (input, ctx) => {
    ctx.log("greet was called");
    return { ok: true, content: \`Hello, \${input.name ?? "world"}!\` };
  },
};
`;
