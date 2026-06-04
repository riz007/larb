import { describe, it, expect, afterEach, vi } from "vitest";
import { OpenAIProvider } from "./openai.js";
import { OllamaProvider } from "./ollama.js";
import type { GenerateRequest, StreamEvent } from "./types.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const REQ: GenerateRequest = {
  system: "s",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("OpenAI streaming (SSE)", () => {
  it("emits incremental text deltas then a final with assembled content + usage", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        [
          'data: {"choices":[{"delta":{"content":"Hel"}}]}',
          'data: {"choices":[{"delta":{"content":"lo"}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
          "data: [DONE]",
        ]
          .map((l) => l + "\n\n")
          .join(""),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    ) as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: "t", prices: [{ match: /.*/, inputPerM: 1, outputPerM: 3 }] });
    const events = await collect(provider.stream(REQ));
    const deltas = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text);
    expect(deltas).toEqual(["Hel", "lo"]);
    const final = events.at(-1);
    expect(final?.type).toBe("final");
    if (final?.type === "final") {
      expect(final.result.content).toEqual([{ type: "text", text: "Hello" }]);
      expect(final.result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
      expect(final.result.stopReason).toBe("end_turn");
    }
  });

  it("assembles a streamed tool call from argument fragments", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"do_it","arguments":"{\\"x\\":"}}]}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
          "data: [DONE]",
        ]
          .map((l) => l + "\n\n")
          .join(""),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    ) as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: "t" });
    const events = await collect(provider.stream(REQ));
    const final = events.at(-1);
    expect(final?.type).toBe("final");
    if (final?.type === "final") {
      expect(final.result.content).toEqual([
        { type: "tool_use", id: "c1", name: "do_it", input: { x: 1 } },
      ]);
      expect(final.result.stopReason).toBe("tool_use");
    }
  });
});

describe("Ollama streaming (NDJSON)", () => {
  it("emits incremental text deltas then a final with usage", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        [
          JSON.stringify({ message: { content: "Hel" } }),
          JSON.stringify({ message: { content: "lo" } }),
          JSON.stringify({ message: { content: "" }, done: true, prompt_eval_count: 4, eval_count: 2 }),
        ].join("\n") + "\n",
        { status: 200, headers: { "content-type": "application/x-ndjson" } },
      ),
    ) as typeof fetch;

    const provider = new OllamaProvider({ defaultModel: "llama3.1" });
    const events = await collect(provider.stream(REQ));
    const deltas = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text);
    expect(deltas).toEqual(["Hel", "lo"]);
    const final = events.at(-1);
    if (final?.type === "final") {
      expect(final.result.content).toEqual([{ type: "text", text: "Hello" }]);
      expect(final.result.usage).toEqual({ inputTokens: 4, outputTokens: 2 });
    }
  });
});
