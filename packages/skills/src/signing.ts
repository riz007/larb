import {
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { larbHome } from "@larb/governors";
import { parseManifest } from "./manifest.js";

export type TrustTier = "first-party" | "verified" | "community";

export interface SkillSignature {
  hash: string;
  signature: string; // base64
  publicKeyPem: string;
}

interface TrustedKey {
  name: string;
  publicKeyPem: string;
  tier: "first-party" | "verified";
}

/**
 * Content hash over the manifest plus the plugin entry and SKILL.md bytes. Any
 * change to the manifest or executable code changes the hash, so a signature
 * covers exactly what will run (provenance).
 */
export function contentHash(skillDir: string): string {
  const h = createHash("sha256");
  const manifestRaw = readFileSync(join(skillDir, "skill.json"), "utf8");
  const manifest = parseManifest(JSON.parse(manifestRaw));
  // Canonicalize manifest so formatting changes don't alter the hash.
  h.update("manifest:");
  h.update(JSON.stringify(sortKeys(JSON.parse(manifestRaw))));
  if (manifest.plugin) {
    const entry = join(skillDir, manifest.plugin.entry);
    if (existsSync(entry)) {
      h.update("plugin:");
      h.update(readFileSync(entry));
    }
  }
  const skillMd = join(skillDir, "SKILL.md");
  if (existsSync(skillMd)) {
    h.update("skill.md:");
    h.update(readFileSync(skillMd));
  }
  return h.digest("hex");
}

export function generateKeypair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function signSkill(skillDir: string, privateKeyPem: string, publicKeyPem: string): SkillSignature {
  const hash = contentHash(skillDir);
  const signature = cryptoSign(null, Buffer.from(hash, "hex"), privateKeyPem).toString("base64");
  const sig: SkillSignature = { hash, signature, publicKeyPem };
  writeFileSync(join(skillDir, "larb.sig"), JSON.stringify(sig, null, 2), "utf8");
  return sig;
}

/**
 * Determine the trust tier of an installed skill.
 * - no signature → community (tightest sandbox, explicit consent)
 * - signature that verifies against a key in the trusted keyring → that key's tier
 * - signature that does not verify, or signer not in keyring → community
 */
export function verifyTier(skillDir: string): { tier: TrustTier; signer?: string; reason?: string } {
  const sigFile = join(skillDir, "larb.sig");
  if (!existsSync(sigFile)) return { tier: "community", reason: "unsigned" };

  let sig: SkillSignature;
  try {
    sig = JSON.parse(readFileSync(sigFile, "utf8")) as SkillSignature;
  } catch {
    return { tier: "community", reason: "malformed signature" };
  }

  const expected = contentHash(skillDir);
  if (sig.hash !== expected) {
    return { tier: "community", reason: "content changed since signing" };
  }
  const ok = (() => {
    try {
      return cryptoVerify(null, Buffer.from(sig.hash, "hex"), sig.publicKeyPem, Buffer.from(sig.signature, "base64"));
    } catch {
      return false;
    }
  })();
  if (!ok) return { tier: "community", reason: "invalid signature" };

  const trusted = trustedKeys().find((k) => normalize(k.publicKeyPem) === normalize(sig.publicKeyPem));
  if (!trusted) return { tier: "community", reason: "signer not in trusted keyring" };
  return { tier: trusted.tier, signer: trusted.name };
}

export function trustedKeys(): TrustedKey[] {
  const file = join(larbHome(), "trusted-keys.json");
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf8")) as TrustedKey[];
  } catch {
    return [];
  }
}

export function addTrustedKey(key: TrustedKey): void {
  const file = join(larbHome(), "trusted-keys.json");
  const keys = trustedKeys().filter((k) => normalize(k.publicKeyPem) !== normalize(key.publicKeyPem));
  keys.push(key);
  writeFileSync(file, JSON.stringify(keys, null, 2), "utf8");
}

function normalize(pem: string): string {
  return pem.replace(/\s+/g, "");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
