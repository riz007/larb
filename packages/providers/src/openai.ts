import type { TokenUsage } from "@larb/governors";
import type {
  ContentBlock,
  GenerateRequest,
  GenerateResult,
  Message,
  ModelProvider,
  StopReason,
  StreamEvent,
} from "./types.js";

const DEFAULT_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_MAX_TOKENS = 8192;

/** USD per 1M tokens, approximate published list prices. */
const PRICES: Array<{ match: RegExp; in: number; out: number }> = [
  { match: /gpt-4o-mini/i, in: 0.15, out: 0.6 },
  { match: /gpt-4o/i, in: 2.5, out: 10 },
  { match: /gpt-4\.1-mini/i, in: 0.4, out: 1.6 },
  { match: /gpt-4\.1/i, in: 2, out: 8 },
  { match: /o[0-9]/i, in: 15, out: 60 },
];

function priceFor(model: string): { in: number; out: number } {
  return PRICES.find((p) => p.match.test(model)) ?? { in: 1, out: 3 };
}

export interface OpenAIProviderOptions {
  apiKey: string;
  defaultModel?: string;
  baseURL?: string;
}

/**
 * OpenAI Chat Completions adapter. Implemented over `fetch` (no SDK) so the
 * network surface stays small and auditable. The same adapter serves any
 * OpenAI-compatible endpoint via `baseURL`.
 */
export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  readonly defaultModel: string;
  private readonly baseURL: string;

  constructor(private readonly opts: OpenAIProviderOptions) {
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.baseURL = (opts.baseURL ?? DEFAULT_BASE).replace(/\/$/, "");
  }

  estimateCost(usage: TokenUsage, model: string): number {
    const p = priceFor(model);
    return (usage.inputTokens / 1e6) * p.in + (usage.outputTokens / 1e6) * p.out;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const model = request.model ?? this.defaultModel;
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: request.temperature,
        messages: toOpenAIMessages(request.system, request.messages),
        tools: request.tools?.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as OpenAIResponse;
    return toResult(model, data, this.estimateCost.bind(this));
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamEvent> {
    // Non-incremental for now: one round-trip, surfaced as text + final.
    const result = await this.generate(request);
    const text = result.content
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text) yield { type: "text", text };
    yield { type: "final", result };
  }

  async countTokens(request: GenerateRequest): Promise<number> {
    const text = JSON.stringify(request.messages) + request.system;
    return Math.ceil(text.length / 4);
  }
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function toResult(
  model: string,
  data: OpenAIResponse,
  estimate: (u: TokenUsage, m: string) => number,
): GenerateResult {
  const choice = data.choices[0];
  const content: ContentBlock[] = [];
  if (choice?.message.content) content.push({ type: "text", text: choice.message.content });
  for (const call of choice?.message.tool_calls ?? []) {
    let input: unknown = {};
    try {
      input = JSON.parse(call.function.arguments || "{}");
    } catch {
      input = {};
    }
    content.push({ type: "tool_use", id: call.id, name: call.function.name, input });
  }
  const usage: TokenUsage = {
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
  return {
    model,
    content,
    stopReason: mapStop(choice?.finish_reason),
    usage,
    costUsd: estimate(usage, model),
  };
}

function mapStop(reason: string | undefined): StopReason {
  switch (reason) {
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "stop":
      return "end_turn";
    default:
      return "stop";
  }
}

/** Flatten the neutral format into OpenAI's role-per-message shape. */
function toOpenAIMessages(system: string, messages: Message[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      const toolCalls = m.content
        .filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      out.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else {
      for (const b of m.content) {
        if (b.type === "text") out.push({ role: "user", content: b.text });
        else if (b.type === "tool_result")
          out.push({ role: "tool", tool_call_id: b.toolUseId, content: b.content });
      }
    }
  }
  return out;
}
