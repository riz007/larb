/**
 * Secrets broker (SPEC §9).
 *
 * The one place a raw API key is read from the environment. A broker is a
 * *handle* to a secret, not the secret itself: it resolves the value lazily from
 * `process.env` only when an adapter is about to make a provider call, and it
 * redacts itself in every serialization path (`toJSON`, `toString`, Node's
 * inspect) so a key can never leak into an audit log, error, or debug dump.
 *
 * Repo config can never choose which env var is read — only trusted global
 * config supplies the name — so an untrusted repo cannot redirect the broker to
 * a variable it controls. The agent loop and tools are never given a broker.
 */
export class SecretUnavailableError extends Error {
  constructor(envName: string) {
    super(
      `No API key found. Set the ${envName} environment variable. ` +
        `Larb never reads keys from repo config.`,
    );
    this.name = "SecretUnavailableError";
  }
}

export class SecretBroker {
  constructor(private readonly envName: string) {}

  /** The env var name (safe to display) — never the value. */
  get name(): string {
    return this.envName;
  }

  /** Whether the secret is present, without exposing it. */
  has(): boolean {
    return Boolean(process.env[this.envName]);
  }

  /** Resolve the secret value. Only a provider adapter should call this. */
  resolve(): string {
    const value = process.env[this.envName];
    if (!value) throw new SecretUnavailableError(this.envName);
    return value;
  }

  redacted(): string {
    return `[redacted:${this.envName}]`;
  }

  // Every serialization path is redacted so the value can never leak.
  toJSON(): string {
    return this.redacted();
  }
  toString(): string {
    return this.redacted();
  }
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.redacted();
  }
}
