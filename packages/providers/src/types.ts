import type { TokenUsage } from "@larb/governors";

/**
 * Provider-neutral message format. No model is privileged in the codebase:
 * adapters translate to/from this shape, never the reverse.
 */
export type Role = "user" | "assistant";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      toolUseId: string;
      content: string;
      isError?: boolean;
    };

export interface Message {
  role: Role;
  content: ContentBlock[];
}

/** A JSON-schema-described tool the model may call. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop";

export interface GenerateRequest {
  system: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  /** Override the routing-selected model for this call. */
  model?: string;
}

export interface GenerateResult {
  model: string;
  content: ContentBlock[];
  stopReason: StopReason;
  usage: TokenUsage;
  costUsd: number;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string }
  | { type: "final"; result: GenerateResult };

/**
 * The thin interface every model provider implements:
 * generate · stream · count_tokens · cost_estimate, plus tool calling via the
 * tools field on GenerateRequest.
 */
export interface ModelProvider {
  readonly name: string;
  readonly defaultModel: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  stream(request: GenerateRequest): AsyncIterable<StreamEvent>;
  countTokens(request: GenerateRequest): Promise<number>;
  /** Estimate USD cost for a usage on a given model. */
  estimateCost(usage: TokenUsage, model: string): number;
}
