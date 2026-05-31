import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { larbHome } from "./paths.js";
import type { AuditLog } from "./audit.js";
import type {
  Approver,
  Capability,
  Decision,
  Grant,
  PermissionRequest,
} from "./types.js";

export class PermissionDeniedError extends Error {
  constructor(public readonly request: PermissionRequest) {
    super(
      `Permission denied: ${request.capability}` +
        (request.path ? ` on ${request.path}` : "") +
        (request.host ? ` to ${request.host}` : ""),
    );
    this.name = "PermissionDeniedError";
  }
}

/**
 * A declarative project policy (from non-executable config).
 * Repo config may *propose* allows but `deny` always wins and config can never
 * grant `secret` or change network base URLs (enforced by the secrets broker).
 */
export interface ProjectPolicy {
  allow?: Array<{ capability: Capability; pathPrefix?: string; host?: string }>;
  deny?: Array<{ capability: Capability; pathPrefix?: string; host?: string }>;
}

/**
 * Fine-grained, layered approvals.
 *
 * Resolution order for each request: deny-policy → allow-policy → persistent
 * grant → session grant → interactive approver. Every grant is logged. A safe
 * autonomy mode is possible because the sandbox is real — we never bypass these
 * checks, and there is no "skip all permissions" escape hatch.
 */
export class PermissionEngine {
  private readonly persistentFile: string;
  private sessionGrants: Grant[] = [];

  constructor(
    private readonly opts: {
      projectRoot: string;
      approver: Approver;
      audit?: AuditLog;
      policy?: ProjectPolicy;
      /** Auto-deny everything that isn't pre-allowed (e.g. `ask` read-only mode). */
      autoDenyUnknown?: boolean;
    },
  ) {
    this.persistentFile = join(larbHome(), "permissions.json");
  }

  /** Throws {@link PermissionDeniedError} if the request is not allowed. */
  async require(request: PermissionRequest): Promise<void> {
    const decision = await this.resolve(request);
    this.opts.audit?.log({ type: "permission", request, decision });
    if (decision === "deny") throw new PermissionDeniedError(request);
  }

  private async resolve(request: PermissionRequest): Promise<Decision> {
    if (this.matchesPolicy(this.opts.policy?.deny, request)) return "deny";
    if (this.matchesPolicy(this.opts.policy?.allow, request)) return "allow-once";

    const existing = [...this.loadPersistent(), ...this.sessionGrants];
    if (existing.some((g) => grantMatches(g, request))) return "allow-once";

    if (this.opts.autoDenyUnknown) return "deny";

    const decision = await this.opts.approver(request);
    if (decision === "allow-session") {
      this.sessionGrants.push(this.makeGrant(request, false));
    } else if (decision === "always") {
      const grant = this.makeGrant(request, true);
      this.sessionGrants.push(grant);
      this.persist(grant);
    }
    return decision;
  }

  private makeGrant(request: PermissionRequest, persistent: boolean): Grant {
    const grant: Grant = { capability: request.capability, persistent };
    switch (request.capability) {
      case "fs.read":
      case "fs.write":
      case "exec":
      case "git":
        grant.pathPrefix = this.opts.projectRoot;
        break;
      case "net":
        grant.host = request.host;
        break;
      case "secret":
        break;
    }
    return grant;
  }

  private matchesPolicy(
    rules: ProjectPolicy["allow"] | ProjectPolicy["deny"],
    request: PermissionRequest,
  ): boolean {
    if (!rules) return false;
    return rules.some((r) =>
      grantMatches(
        { capability: r.capability, pathPrefix: r.pathPrefix, host: r.host, persistent: false },
        request,
      ),
    );
  }

  private loadPersistent(): Grant[] {
    if (!existsSync(this.persistentFile)) return [];
    try {
      return JSON.parse(readFileSync(this.persistentFile, "utf8")) as Grant[];
    } catch {
      return [];
    }
  }

  private persist(grant: Grant): void {
    const all = this.loadPersistent();
    all.push(grant);
    writeFileSync(this.persistentFile, JSON.stringify(all, null, 2), "utf8");
  }
}

function grantMatches(grant: Grant, request: PermissionRequest): boolean {
  if (grant.capability !== request.capability) return false;
  if (grant.pathPrefix) {
    if (!request.path) return false;
    if (!resolve(request.path).startsWith(resolve(grant.pathPrefix))) return false;
  }
  if (grant.host) {
    if (request.host !== grant.host) return false;
  }
  return true;
}
