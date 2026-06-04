// Bundle the Larb CLI into a single executable file so `larb` works after a
// global install / `npm link` (the bin target packages/cli/dist/index.js).
//
// We bundle only the @larb/* workspace TypeScript (resolved via explicit aliases
// to each package's source) and keep third-party deps external — they resolve
// from node_modules at runtime. This keeps the bundle small and sidesteps a
// parent-directory Yarn PnP manifest that otherwise hijacks esbuild resolution.
//
// esbuild is loaded from pnpm's store because it isn't hoisted to top-level
// node_modules on this setup.
import { existsSync, chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function resolveEsbuild() {
  const direct = join(root, "node_modules/esbuild/lib/main.js");
  if (existsSync(direct)) return direct;
  const pnpm = join(root, "node_modules/.pnpm");
  if (existsSync(pnpm)) {
    const dir = readdirSync(pnpm)
      .filter((d) => d.startsWith("esbuild@"))
      .sort()
      .pop();
    if (dir) {
      const p = join(pnpm, dir, "node_modules/esbuild/lib/main.js");
      if (existsSync(p)) return p;
    }
  }
  throw new Error("esbuild not found — run `pnpm install` first.");
}

const esbuild = await import(pathToFileURL(await resolveEsbuild()).href);

// Map @larb/<pkg> → its TypeScript entry so esbuild compiles + inlines it.
const WORKSPACES = [
  "core",
  "providers",
  "sandbox",
  "context",
  "governors",
  "skills",
  "skills-sdk",
];
const alias = Object.fromEntries(
  WORKSPACES.map((p) => [`@larb/${p}`, join(root, "packages", p, "src/index.ts")]),
);

// Everything that isn't relative or a @larb/* workspace stays external (resolved
// from node_modules at runtime) — react, ink, the Anthropic SDK, zod, etc.
const externalThirdParty = {
  name: "external-third-party",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@larb/")) return null; // bundle workspace source
      return { path: args.path, external: true };
    });
  },
};

const outfile = join(root, "packages/cli/dist/index.js");
mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "packages/cli/src/index.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  alias,
  plugins: [externalThirdParty],
  // Provide `require` for any bundled CJS interop (ESM output on Node).
  banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
  logLevel: "info",
});

// Guarantee a single shebang as line 1 (esbuild hoists imports above banners,
// and a shebang is only valid on the first line).
const SHEBANG = "#!/usr/bin/env node";
const body = readFileSync(outfile, "utf8").replace(new RegExp(`^${SHEBANG}\\n`, "gm"), "");
writeFileSync(outfile, `${SHEBANG}\n${body}`);
chmodSync(outfile, 0o755);
console.log(`Built ${outfile}`);
