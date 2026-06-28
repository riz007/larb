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
    return toResult(model, data, toolNamesOf(request));
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

    const content = assembleContent(textAcc, toolCalls, toolNamesOf(request));
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

function toResult(model: string, data: OllamaResponse, toolNames: Set<string>): GenerateResult {
  const content = assembleContent(data.message.content ?? "", data.message.tool_calls ?? [], toolNames);
  const usage: TokenUsage = {
    inputTokens: data.prompt_eval_count ?? 0,
    outputTokens: data.eval_count ?? 0,
  };
  const stopReason: StopReason = content.some((b) => b.type === "tool_use")
    ? "tool_use"
    : "end_turn";
  return { model, content, stopReason, usage, costUsd: 0 };
}

type OllamaToolCall = { function: { name: string; arguments?: Record<string, unknown> } };

function toolNamesOf(request: GenerateRequest): Set<string> {
  return new Set((request.tools ?? []).map((t) => t.name));
}

/**
 * Build the assistant content blocks from an Ollama reply.
 *
 * Prefers structured `tool_calls`. But many local models (e.g. several Qwen and
 * Llama builds) emit the call as JSON *text* instead — `{"name":...,"arguments":...}`,
 * sometimes wrapped in <tool_call> tags or a ```json fence. When no structured
 * call is present and tools were offered, we recover those text calls (guarded by
 * a tool-name match so ordinary JSON output the user asked for is never
 * misread). This is what makes the agent loop actually work across local models.
 */
export function assembleContent(
  text: string,
  toolCalls: OllamaToolCall[],
  toolNames: Set<string>,
): ContentBlock[] {
  const content: ContentBlock[] = [];
  let i = 0;
  const pushCall = (name: string, args: Record<string, unknown>) =>
    content.push({ type: "tool_use", id: `ollama_${Date.now()}_${i++}`, name, input: args });

  if (toolCalls.length > 0) {
    if (text) content.push({ type: "text", text });
    for (const c of toolCalls) pushCall(c.function.name, c.function.arguments ?? {});
    return content;
  }

  const recovered = parseTextToolCalls(text, toolNames);
  if (recovered.length > 0) {
    // The text WAS the tool call(s); drop it and surface structured calls only.
    for (const c of recovered) pushCall(c.name, c.arguments);
    return content;
  }

  if (text) content.push({ type: "text", text });
  return content;
}

/** Recover tool calls a model emitted as JSON text rather than `tool_calls`. */
export function parseTextToolCalls(
  text: string,
  toolNames: Set<string>,
): Array<{ name: string; arguments: Record<string, unknown> }> {
  if (!text || toolNames.size === 0) return [];
  const candidates: string[] = [];
  for (const re of [/<tool_call>([\s\S]*?)<\/tool_call>/g, /```(?:json)?\s*([\s\S]*?)```/g]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) candidates.push(m[1]!);
  }
  if (candidates.length === 0) candidates.push(text);

  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  for (const c of candidates) {
    for (const obj of extractJsonObjects(c)) {
      const name = typeof obj.name === "string" ? obj.name : undefined;
      if (!name || !toolNames.has(name)) continue;
      const raw = obj.arguments ?? obj.parameters ?? {};
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        calls.push({ name, arguments: raw as Record<string, unknown> });
      }
    }
  }
  return calls;
}

/** Extract every balanced top-level JSON object from a string (string-aware). */
function extractJsonObjects(s: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            const parsed = JSON.parse(s.slice(start, i + 1));
            if (parsed && typeof parsed === "object") out.push(parsed as Record<string, unknown>);
          } catch {
            /* not valid JSON — skip */
          }
          start = -1;
        }
      }
    }
  }
  return out;
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
