import { describe, it, expect, vi } from "vitest";

// Mock the Anthropic SDK so conformance runs without network or a real key.
vi.mock("@anthropic-ai/sdk", () => {
  const message = {
    content: [{ type: "text", text: "hello" }],
    usage: { input_tokens: 3, output_tokens: 1 },
    stop_reason: "end_turn",
  };
  class FakeAnthropic {
    messages = {
      create: async () => message,
      stream: () => {
        async function* gen() {
          yield { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } };
        }
        return Object.assign(gen(), { finalMessage: async () => message });
      },
      countTokens: async () => ({ input_tokens: 7 }),
    };
    constructor(_opts: unknown) {}
  }
  return { default: FakeAnthropic };
});

import { runConformance } from "./conformance.js";
import { AnthropicProvider } from "./anthropic.js";

describe("AnthropicProvider conformance (mocked SDK)", () => {
  it("passes the contract", async () => {
    const provider = new AnthropicProvider({ apiKey: "test" });
    const report = await runConformance(provider);
    if (!report.pass) console.error(report.checks.filter((c) => !c.ok));
    expect(report.pass).toBe(true);
  });
});
