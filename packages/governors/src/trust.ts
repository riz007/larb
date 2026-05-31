import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { larbHome } from "./paths.js";

interface TrustEntry {
  path: string;
  trustedAt: string;
  /** Whether command execution / network was granted at trust time. */
  scope: "read-only" | "full";
}

type TrustStore = Record<string, TrustEntry>;

/**
 * Trust-before-anything boot.
 *
 * On opening any directory Larb reads ZERO executable/config-as-code and makes
 * ZERO network/exec calls until the user makes a trust decision. This engine
 * only records and answers "has the user trusted this directory?". The boot
 * sequence in the CLI consults it before anything else runs.
 *
 * Trust is keyed by the realpath hash so symlink games can't impersonate a
 * previously-trusted directory.
 */
export class TrustEngine {
  private readonly storeFile: string;

  constructor() {
    this.storeFile = join(larbHome(), "trust.json");
  }

  private key(dir: string): string {
    let real: string;
    try {
      real = realpathSync(resolve(dir));
    } catch {
      real = resolve(dir);
    }
    return createHash("sha256").update(real).digest("hex");
  }

  private read(): TrustStore {
    if (!existsSync(this.storeFile)) return {};
    try {
      return JSON.parse(readFileSync(this.storeFile, "utf8")) as TrustStore;
    } catch {
      return {};
    }
  }

  private write(store: TrustStore): void {
    writeFileSync(this.storeFile, JSON.stringify(store, null, 2), "utf8");
  }

  status(dir: string): TrustEntry | undefined {
    return this.read()[this.key(dir)];
  }

  isTrusted(dir: string): boolean {
    return this.status(dir) !== undefined;
  }

  trust(dir: string, scope: TrustEntry["scope"]): void {
    const store = this.read();
    store[this.key(dir)] = {
      path: realpathSafe(dir),
      trustedAt: new Date().toISOString(),
      scope,
    };
    this.write(store);
  }

  revoke(dir: string): void {
    const store = this.read();
    delete store[this.key(dir)];
    this.write(store);
  }
}

function realpathSafe(dir: string): string {
  try {
    return realpathSync(resolve(dir));
  } catch {
    return resolve(dir);
  }
}
