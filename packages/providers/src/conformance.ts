import type { GenerateRequest, ModelProvider, StreamEvent } from "./types.js";

/**
 * Provider conformance suite.
 *
 * A reusable, provider-agnostic check that any {@link ModelProvider} honors the
 * neutral contract: a well-formed `generate` result, a `stream` that ends in
 * exactly one `final`, a positive `countTokens`, and a non-negative, monotonic
 * `estimateCost`. It serves the §14 "providers passing the conformance suite"
 * portability metric and lets community adapters self-test against the same bar
 * the built-in adapters meet.
 *
 * It drives only the public interface — point it at a provider configured to
 * talk to a mock transport (built-in adapter tests) or a live endpoint
 * (integration). It never asserts a *specific* model output, only that whatever
 * comes back is structurally valid.
 */
export interface ConformanceCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ConformanceReport {
  provider: string;
  pass: boolean;
  checks: ConformanceCheck[];
}

const SAMPLE: GenerateRequest = {
  system: "You are a terse assistant.",
  messages: [{ role: "user", content: [{ type: "text", text: "Say hello in one word." }] }],
};

export async function runConformance(provider: ModelProvider): Promise<ConformanceReport> {
  const checks: ConformanceCheck[] = [];
  const check = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      checks.push({ name, ok: true });
    } catch (err) {
      checks.push({ name, ok: false, detail: (err as Error).message });
    }
  };

  await check("identity", () => {
    assert(typeof provider.name === "string" && provider.name.length > 0, "name must be a non-empty string");
    assert(typeof provider.defaultModel === "string", "defaultModel must be a string");
  });

  await check("generate returns a well-formed result", async () => {
    const r = await provider.generate(SAMPLE);
    assert(typeof r.model === "string" && r.model.length > 0, "result.model missing");
    assert(Array.isArray(r.content), "result.content must be an array");
    for (const b of r.content) assertValidBlock(b);
    assert(Number.isInteger(r.usage.inputTokens) && r.usage.inputTokens >= 0, "inputTokens invalid");
    assert(Number.isInteger(r.usage.outputTokens) && r.usage.outputTokens >= 0, "outputTokens invalid");
    assert(typeof r.costUsd === "number" && r.costUsd >= 0, "costUsd must be >= 0");
    assert(
      ["end_turn", "tool_use", "max_tokens", "stop"].includes(r.stopReason),
      `invalid stopReason: ${r.stopReason}`,
    );
  });

  await check("stream ends with exactly one final", async () => {
    const events: StreamEvent[] = [];
    for await (const ev of provider.stream(SAMPLE)) events.push(ev);
    const finals = events.filter((e) => e.type === "final");
    assert(finals.length === 1, `expected exactly 1 final event, got ${finals.length}`);
    assert(events[events.length - 1]?.type === "final", "final must be the last event");
    for (const e of events) {
      if (e.type === "text") assert(typeof e.text === "string", "text event must carry a string");
    }
  });

  await check("countTokens is a positive integer", async () => {
    const n = await provider.countTokens(SAMPLE);
    assert(Number.isInteger(n) && n > 0, `countTokens returned ${n}`);
  });

  await check("estimateCost is non-negative and monotonic", () => {
    const model = provider.defaultModel;
    const zero = provider.estimateCost({ inputTokens: 0, outputTokens: 0 }, model);
    const small = provider.estimateCost({ inputTokens: 1000, outputTokens: 1000 }, model);
    const big = provider.estimateCost({ inputTokens: 2000, outputTokens: 2000 }, model);
    assert(zero >= 0 && small >= 0 && big >= 0, "costs must be >= 0");
    assert(zero <= small && small <= big, "cost must not decrease as usage grows");
  });

  return { provider: provider.name, pass: checks.every((c) => c.ok), checks };
}

function assert(cond: boolean, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function assertValidBlock(b: unknown): void {
  const block = b as { type?: string };
  assert(
    block.type === "text" || block.type === "tool_use" || block.type === "tool_result",
    `invalid content block type: ${String(block.type)}`,
  );
}
