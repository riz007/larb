import { describe, it, expect, vi } from "vitest";

// Capture the args passed to messages.create so we can assert cache breakpoints.
const calls: unknown[] = [];
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (params: unknown) => {
        calls.push(params);
        return {
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 10,
            output_tokens: 2,
            cache_read_input_tokens: 1000,
            cache_creation_input_tokens: 500,
          },
        };
      },
    };
    constructor(_opts: unknown) {}
  }
  return { default: FakeAnthropic };
});

import { AnthropicProvider } from "./anthropic.js";

describe("Anthropic prompt caching", () => {
  it("marks the system prompt and the last tool with cache_control", async () => {
    const provider = new AnthropicProvider({ apiKey: "t" });
    await provider.generate({
      system: "big stable system prompt",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [
        { name: "a", description: "a", inputSchema: { type: "object" } },
        { name: "b", description: "b", inputSchema: { type: "object" } },
      ],
    });
    const params = calls.at(-1) as {
      system: Array<{ cache_control?: unknown }>;
      tools: Array<{ name: string; cache_control?: unknown }>;
    };
    // System is a cacheable block.
    expect(params.system[0]?.cache_control).toEqual({ type: "ephemeral" });
    // Only the LAST tool carries the breakpoint (caches the system+tools prefix).
    expect(params.tools[0]?.cache_control).toBeUndefined();
    expect(params.tools[1]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("surfaces cache read/write usage in the result", async () => {
    const provider = new AnthropicProvider({ apiKey: "t" });
    const r = await provider.generate({
      system: "s",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    expect(r.usage.cacheReadTokens).toBe(1000);
    expect(r.usage.cacheWriteTokens).toBe(500);
  });
});
