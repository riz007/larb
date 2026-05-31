import { TrustEngine } from "@larb/governors";

/**
 * Manage the trust decision for a directory. Flags exist for scripting/CI,
 * where they represent an explicit, deliberate user action — never a silent
 * default.
 */
export function trustCommand(projectRoot: string, args: string[]): void {
  const engine = new TrustEngine();

  if (args.includes("--revoke")) {
    engine.revoke(projectRoot);
    console.log(`Revoked trust for ${projectRoot}.`);
    return;
  }

  const wantFull = args.includes("--full") || args.includes("--yes");
  const wantReadOnly = args.includes("--read-only");

  if (wantFull || wantReadOnly) {
    const scope = wantFull ? "full" : "read-only";
    engine.trust(projectRoot, scope);
    console.log(`Trusted ${projectRoot} (${scope}).`);
    return;
  }

  const status = engine.status(projectRoot);
  if (status) {
    console.log(`Trusted: ${status.path}`);
    console.log(`  scope: ${status.scope}`);
    console.log(`  since: ${status.trustedAt}`);
  } else {
    console.log(`Not trusted: ${projectRoot}`);
  }
  console.log("");
  console.log("Usage: larb trust [--full | --read-only | --revoke]");
  console.log("  (interactive `larb run` / `larb ask` will also prompt)");
}
