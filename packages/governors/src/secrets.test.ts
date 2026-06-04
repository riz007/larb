import { describe, it, expect, afterEach } from "vitest";
import { inspect } from "node:util";
import { SecretBroker, SecretUnavailableError } from "./secrets.js";

const ENV = "LARB_TEST_SECRET";
afterEach(() => {
  delete process.env[ENV];
});

describe("SecretBroker", () => {
  it("resolves the value from the environment only when asked", () => {
    process.env[ENV] = "sk-super-secret";
    const broker = new SecretBroker(ENV);
    expect(broker.has()).toBe(true);
    expect(broker.resolve()).toBe("sk-super-secret");
  });

  it("throws when the secret is absent", () => {
    const broker = new SecretBroker(ENV);
    expect(broker.has()).toBe(false);
    expect(() => broker.resolve()).toThrow(SecretUnavailableError);
  });

  it("never leaks the value through any serialization path", () => {
    process.env[ENV] = "sk-super-secret";
    const broker = new SecretBroker(ENV);

    // JSON (e.g. accidental inclusion in an audit record or config dump).
    const json = JSON.stringify({ provider: { key: broker } });
    expect(json).not.toContain("sk-super-secret");
    expect(json).toContain("[redacted:LARB_TEST_SECRET]");

    // String coercion and console/util.inspect.
    expect(`${broker}`).not.toContain("sk-super-secret");
    expect(inspect(broker)).not.toContain("sk-super-secret");
    expect(inspect({ broker })).toContain("[redacted:LARB_TEST_SECRET]");

    // The name is safe to surface; the value is not.
    expect(broker.name).toBe(ENV);
  });
});
