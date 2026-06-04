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
import { readLines, safeJson } from "./stream.js";

const DEFAULT_BASE = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.1";

export interface OllamaProviderOptions {
  defaultModel?: string;
  baseURL?: string;
}

/**
 * Local model adapter for an Ollama server. Runs fully offline with no API key
 * and no spend, which makes it ideal for testing the loop without cost. Tool
 * calling depends on the chosen model supporting it.
 */
export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";
  readonly defaultModel: string;
  private readonly baseURL: string;

  constructor(opts: OllamaProviderOptions = {}) {
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.baseURL = (opts.baseURL ?? DEFAULT_BASE).replace(/\/$/, "");
  }

  estimateCost(): number {
    return 0; // local inference is free
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const model = request.model ?? this.defaultModel;
    const res = await fetch(`${this.baseURL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: toOllamaMessages(request.system, request.messages),
        tools: request.tools?.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
        options: request.temperature != null ? { temperature: request.temperature } : undefined,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as OllamaResponse;
    return toResult(model, data);
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamEvent> {
    const model = request.model ?? this.defaultModel;
    const res = await fetch(`${this.baseURL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        messages: toOllamaMessages(request.system, request.messages),
        tools: request.tools?.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
        options: request.temperature != null ? { temperature: request.temperature } : undefined,
      }),
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);

    if (!res.body) {
      const result = await this.generate(request);
      const text = textOf(result.content);
      if (text) yield { type: "text", text };
      yield { type: "final", result };
      return;
    }

    // Ollama streams newline-delimited JSON; the last object has done:true.
    let textAcc = "";
    const toolCalls: OllamaResponse["message"]["tool_calls"] = [];
    let usage = { inputTokens: 0, outputTokens: 0 };

    for await (const line of readLines(res.body)) {
      if (!line.trim()) continue;
      const data = safeJson(line) as OllamaResponse;
      if (data.message?.content) {
        textAcc += data.message.content;
        yield { type: "text", text: data.message.content };
      }
      for (const c of data.message?.tool_calls ?? []) toolCalls.push(c);
      if (typeof data.prompt_eval_count === "number") usage.inputTokens = data.prompt_eval_count;
      if (typeof data.eval_count === "number") usage.outputTokens = data.eval_count;
    }

    const content: ContentBlock[] = [];
    if (textAcc) content.push({ type: "text", text: textAcc });
    let i = 0;
    for (const call of toolCalls) {
      content.push({
        type: "tool_use",
        id: `ollama_${Date.now()}_${i++}`,
        name: call.function.name,
        input: call.function.arguments ?? {},
      });
    }
    yield {
      type: "final",
      result: {
        model,
        content,
        stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
        usage,
        costUsd: 0,
      },
    };
  }

  async countTokens(request: GenerateRequest): Promise<number> {
    const text = JSON.stringify(request.messages) + request.system;
    return Math.ceil(text.length / 4);
  }
}

interface OllamaResponse {
  message: {
    content: string;
    tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function toResult(model: string, data: OllamaResponse): GenerateResult {
  const content: ContentBlock[] = [];
  if (data.message.content) content.push({ type: "text", text: data.message.content });
  let i = 0;
  for (const call of data.message.tool_calls ?? []) {
    content.push({
      type: "tool_use",
      id: `ollama_${Date.now()}_${i++}`,
      name: call.function.name,
      input: call.function.arguments ?? {},
    });
  }
  const usage: TokenUsage = {
    inputTokens: data.prompt_eval_count ?? 0,
    outputTokens: data.eval_count ?? 0,
  };
  const stopReason: StopReason = content.some((b) => b.type === "tool_use")
    ? "tool_use"
    : "end_turn";
  return { model, content, stopReason, usage, costUsd: 0 };
}

function toOllamaMessages(system: string, messages: Message[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      const toolCalls = m.content
        .filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use")
        .map((b) => ({ function: { name: b.name, arguments: b.input ?? {} } }));
      out.push({
        role: "assistant",
        content: text,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else {
      for (const b of m.content) {
        if (b.type === "text") out.push({ role: "user", content: b.text });
        else if (b.type === "tool_result") out.push({ role: "tool", content: b.content });
      }
    }
  }
  return out;
}
