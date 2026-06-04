import type { TokenUsage } from "@larb/governors";
import type { PriceEntry } from "./presets.js";
import type {
  ContentBlock,
  GenerateRequest,
  GenerateResult,
  Message,
  ModelProvider,
  StopReason,
  StreamEvent,
} from "./types.js";
import { readLines, safeJson } from "./stream.js";

const DEFAULT_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_MAX_TOKENS = 8192;

/** Used when no model in the price table matches and no table was supplied. */
const FALLBACK_PRICE = { inputPerM: 1, outputPerM: 3 };

export interface OpenAIProviderOptions {
  apiKey: string;
  defaultModel?: string;
  baseURL?: string;
  /** Per-provider price table; set by the preset so cost is per-provider. */
  prices?: PriceEntry[];
}

/**
 * OpenAI Chat Completions adapter. Implemented over `fetch` (no SDK) so the
 * network surface stays small and auditable. The same adapter serves any
 * OpenAI-compatible endpoint (DeepSeek, Gemini, Groq, Mistral, xAI, …) via
 * `baseURL`, with the matching `prices` supplied by the provider preset.
 */
export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  readonly defaultModel: string;
  private readonly baseURL: string;
  private readonly prices: PriceEntry[];

  constructor(private readonly opts: OpenAIProviderOptions) {
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.baseURL = (opts.baseURL ?? DEFAULT_BASE).replace(/\/$/, "");
    this.prices = opts.prices ?? [];
  }

  estimateCost(usage: TokenUsage, model: string): number {
    const p = this.prices.find((entry) => entry.match.test(model)) ?? FALLBACK_PRICE;
    return (usage.inputTokens / 1e6) * p.inputPerM + (usage.outputTokens / 1e6) * p.outputPerM;
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
        stream: true,
        stream_options: { include_usage: true },
        messages: toOpenAIMessages(request.system, request.messages),
        tools: request.tools?.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);

    // Some compatible endpoints ignore stream:true and return plain JSON; fall
    // back to a single round-trip so streaming is never a hard requirement.
    if (!res.body || !res.headers.get("content-type")?.includes("event-stream")) {
      const data = (await res.json()) as OpenAIResponse;
      const result = toResult(model, data, this.estimateCost.bind(this));
      const text = textOf(result.content);
      if (text) yield { type: "text", text };
      yield { type: "final", result };
      return;
    }

    let textAcc = "";
    const tools = new Map<number, { id: string; name: string; args: string }>();
    let usage = { inputTokens: 0, outputTokens: 0 };
    let finish: string | undefined;

    for await (const line of readLines(res.body)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (payload === "[DONE]") break;
      const data = safeJson(payload) as OpenAIStreamChunk;
      const choice = data.choices?.[0];
      if (choice?.delta?.content) {
        textAcc += choice.delta.content;
        yield { type: "text", text: choice.delta.content };
      }
      for (const tc of choice?.delta?.tool_calls ?? []) {
        const cur = tools.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        tools.set(tc.index, cur);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (data.usage) {
        usage = {
          inputTokens: data.usage.prompt_tokens ?? 0,
          outputTokens: data.usage.completion_tokens ?? 0,
        };
      }
    }

    const content: ContentBlock[] = [];
    if (textAcc) content.push({ type: "text", text: textAcc });
    for (const t of tools.values()) {
      content.push({ type: "tool_use", id: t.id, name: t.name, input: safeJson(t.args) });
    }
    yield {
      type: "final",
      result: {
        model,
        content,
        stopReason: mapStop(finish),
        usage,
        costUsd: this.estimateCost(usage, model),
      },
    };
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

/** One SSE chunk in a streamed Chat Completions response. */
interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
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
