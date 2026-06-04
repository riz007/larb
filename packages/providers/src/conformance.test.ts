import { describe, it, expect, afterEach, vi } from "vitest";
import { runConformance } from "./conformance.js";
import { OpenAIProvider } from "./openai.js";
import { OllamaProvider } from "./ollama.js";
import type { GenerateRequest, GenerateResult, ModelProvider, StreamEvent } from "./types.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** A minimal provider that fully honors the contract. */
const goodProvider: ModelProvider = {
  name: "good",
  defaultModel: "good-1",
  async generate(): Promise<GenerateResult> {
    return {
      model: "good-1",
      content: [{ type: "text", text: "hello" }],
      stopReason: "end_turn",
      usage: { inputTokens: 3, outputTokens: 1 },
      costUsd: 0,
    };
  },
  async *stream(): AsyncIterable<StreamEvent> {
    yield { type: "text", text: "hello" };
    yield { type: "final", result: await this.generate({} as GenerateRequest) };
  },
  async countTokens() {
    return 5;
  },
  estimateCost(usage) {
    return (usage.inputTokens + usage.outputTokens) * 0.001;
  },
};

describe("runConformance", () => {
  it("passes a contract-honoring provider", async () => {
    const report = await runConformance(goodProvider);
    expect(report.pass).toBe(true);
    expect(report.checks.every((c) => c.ok)).toBe(true);
  });

  it("fails a provider whose stream never emits a final", async () => {
    const broken: ModelProvider = {
      ...goodProvider,
      async *stream(): AsyncIterable<StreamEvent> {
        yield { type: "text", text: "oops" };
      },
    };
    const report = await runConformance(broken);
    expect(report.pass).toBe(false);
    expect(report.checks.find((c) => c.name.includes("final"))?.ok).toBe(false);
  });

  it("fails a provider with non-monotonic cost", async () => {
    const broken: ModelProvider = { ...goodProvider, estimateCost: () => -1 };
    const report = await runConformance(broken);
    expect(report.pass).toBe(false);
    expect(report.checks.find((c) => c.name.includes("estimateCost"))?.ok).toBe(false);
  });
});

describe("built-in adapters conform (mocked transport)", () => {
  it("OpenAIProvider passes against a mocked Chat Completions response", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }),
    ) as typeof fetch;

    const provider = new OpenAIProvider({
      apiKey: "test",
      prices: [{ match: /.*/, inputPerM: 1, outputPerM: 3 }],
    });
    const report = await runConformance(provider);
    expect(report.pass).toBe(true);
  });

  it("OllamaProvider passes against a mocked /api/chat response", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        message: { content: "hello" },
        done_reason: "stop",
        prompt_eval_count: 3,
        eval_count: 1,
      }),
    ) as typeof fetch;

    const provider = new OllamaProvider({ defaultModel: "llama3.1" });
    const report = await runConformance(provider);
    expect(report.pass).toBe(true);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
