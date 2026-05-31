import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { OllamaProvider } from "./ollama.js";
import type { ModelProvider } from "./types.js";

export type ProviderKind = "anthropic" | "openai" | "ollama";

export type AgentRole = "orchestrator" | "worker";

/**
 * Declarative provider + routing config. Routing is a policy, not hardcoded:
 * orchestration → strong model, subagents/lint-fixes → cheap/fast model.
 * The API key is read from the environment by the secrets broker, never from
 * repo config, and `baseURL` cannot be set by untrusted repo config.
 */
export interface ProviderConfig {
  kind: ProviderKind;
  /** Env var name holding the API key (default per provider). */
  apiKeyEnv?: string;
  baseURL?: string;
  models: {
    orchestrator: string;
    worker?: string;
  };
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  kind: "anthropic",
  models: {
    orchestrator: "claude-opus-4-8",
    worker: "claude-haiku-4-5-20251001",
  },
};

const DEFAULT_KEY_ENV: Record<ProviderKind, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  ollama: "", // local: no key required
};

export class MissingApiKeyError extends Error {
  constructor(envName: string) {
    super(
      `No API key found. Set the ${envName} environment variable. ` +
        `Larb never reads keys from repo config.`,
    );
    this.name = "MissingApiKeyError";
  }
}

/**
 * Builds the provider and resolves models by role. The secrets broker boundary:
 * the key is read here from the environment and handed only to the SDK client —
 * the agent loop and tools never see it.
 */
export class ProviderRouter {
  readonly provider: ModelProvider;

  constructor(private readonly config: ProviderConfig) {
    switch (config.kind) {
      case "anthropic":
        this.provider = new AnthropicProvider({
          apiKey: requireKey(config),
          defaultModel: config.models.orchestrator,
          baseURL: config.baseURL,
        });
        break;
      case "openai":
        this.provider = new OpenAIProvider({
          apiKey: requireKey(config),
          defaultModel: config.models.orchestrator,
          baseURL: config.baseURL,
        });
        break;
      case "ollama":
        this.provider = new OllamaProvider({
          defaultModel: config.models.orchestrator,
          baseURL: config.baseURL,
        });
        break;
    }
  }

  modelFor(role: AgentRole): string {
    if (role === "worker") {
      return this.config.models.worker ?? this.config.models.orchestrator;
    }
    return this.config.models.orchestrator;
  }
}

/** Read the provider's API key from the environment (the secrets-broker boundary). */
function requireKey(config: ProviderConfig): string {
  const envName = config.apiKeyEnv ?? DEFAULT_KEY_ENV[config.kind];
  const apiKey = process.env[envName];
  if (!apiKey) throw new MissingApiKeyError(envName);
  return apiKey;
}
