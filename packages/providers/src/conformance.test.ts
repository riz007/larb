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
  it("OpenAIProvider passes (JSON for generate, SSE for stream)", async () => {
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      isStreaming(init)
        ? sseResponse([
            'data: {"choices":[{"delta":{"content":"hello"}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
            "data: [DONE]",
          ])
        : jsonResponse({
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

  it("OllamaProvider passes (JSON for generate, NDJSON for stream)", async () => {
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      isStreaming(init)
        ? ndjsonResponse([
            { message: { content: "hello" } },
            { message: { content: "" }, done: true, prompt_eval_count: 3, eval_count: 1 },
          ])
        : jsonResponse({
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

function isStreaming(init: RequestInit | undefined): boolean {
  try {
    return Boolean(JSON.parse(String(init?.body ?? "{}")).stream);
  } catch {
    return false;
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(lines: string[]): Response {
  return new Response(lines.map((l) => l + "\n\n").join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function ndjsonResponse(objs: unknown[]): Response {
  return new Response(objs.map((o) => JSON.stringify(o)).join("\n") + "\n", {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}
