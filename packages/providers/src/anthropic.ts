import Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "@larb/governors";
import { estimateCost } from "./pricing.js";
import type {
  ContentBlock,
  GenerateRequest,
  GenerateResult,
  Message,
  ModelProvider,
  StopReason,
  StreamEvent,
  ToolDefinition,
} from "./types.js";

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_MAX_TOKENS = 8192;

export interface AnthropicProviderOptions {
  apiKey: string;
  defaultModel?: string;
  /** Allowed only via trusted config — never silently from repo config. */
  baseURL?: string;
}

/**
 * Anthropic Messages API adapter. Translates the provider-neutral message/tool
 * format to and from the Anthropic SDK. The same adapter also serves any
 * Anthropic-compatible endpoint via `baseURL`.
 */
export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  readonly defaultModel: string;
  private readonly client: Anthropic;

  constructor(opts: AnthropicProviderOptions) {
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  }

  estimateCost(usage: TokenUsage, model: string): number {
    return estimateCost(usage, model);
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const model = request.model ?? this.defaultModel;
    const msg = await this.client.messages.create({
      model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature,
      system: request.system,
      messages: toAnthropicMessages(request.messages),
      tools: request.tools ? request.tools.map(toAnthropicTool) : undefined,
    });
    return this.toResult(model, msg);
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamEvent> {
    const model = request.model ?? this.defaultModel;
    const stream = this.client.messages.stream({
      model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature,
      system: request.system,
      messages: toAnthropicMessages(request.messages),
      tools: request.tools ? request.tools.map(toAnthropicTool) : undefined,
    });

    for await (const event of stream as AsyncIterable<AnthropicStreamEvent>) {
      if (
        event.type === "content_block_start" &&
        event.content_block?.type === "tool_use"
      ) {
        yield {
          type: "tool_use",
          id: event.content_block.id,
          name: event.content_block.name,
        };
      } else if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta"
      ) {
        yield { type: "text", text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    yield { type: "final", result: this.toResult(model, final) };
  }

  async countTokens(request: GenerateRequest): Promise<number> {
    try {
      const res = await this.client.messages.countTokens({
        model: request.model ?? this.defaultModel,
        system: request.system,
        messages: toAnthropicMessages(request.messages),
        tools: request.tools ? request.tools.map(toAnthropicTool) : undefined,
      });
      return res.input_tokens;
    } catch {
      // Fallback heuristic (~4 chars/token) if the endpoint is unavailable.
      const text = JSON.stringify(request.messages) + request.system;
      return Math.ceil(text.length / 4);
    }
  }

  private toResult(model: string, msg: Anthropic.Message): GenerateResult {
    const content: ContentBlock[] = [];
    for (const block of msg.content) {
      if (block.type === "text")
        content.push({ type: "text", text: block.text });
      else if (block.type === "tool_use")
        content.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        });
    }
    const usage: TokenUsage = {
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
    };
    return {
      model,
      content,
      stopReason: mapStopReason(msg.stop_reason),
      usage,
      costUsd: estimateCost(usage, model),
    };
  }
}

/** Minimal structural view of the SDK stream events we consume. */
interface AnthropicStreamEvent {
  type: string;
  content_block?: { type: string; id: string; name: string };
  delta?: { type: string; text: string };
}

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map(toAnthropicBlock),
  }));
}

function toAnthropicBlock(block: ContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
  }
}

function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  };
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    default:
      return "stop";
  }
}
