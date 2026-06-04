import { SecretBroker } from "@larb/governors";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { OllamaProvider } from "./ollama.js";
import { PROVIDER_PRESETS, isKnownProvider, listProviders } from "./presets.js";
import type { ProviderKind, ProviderPreset } from "./presets.js";
import type { ModelProvider } from "./types.js";

export type { ProviderKind } from "./presets.js";

export type AgentRole = "orchestrator" | "worker";

/**
 * Declarative provider + routing config. Routing is a policy, not hardcoded:
 * orchestration → strong model, subagents/lint-fixes → cheap/fast model.
 *
 * `kind` names a built-in provider preset (anthropic, openai, ollama, deepseek,
 * gemini, groq, mistral, xai, openrouter, together, perplexity). Each preset
 * supplies a default baseURL, key env var, models, and pricing — all
 * overridable here from TRUSTED config only. The API key is read from the
 * environment by the secrets broker, never from repo config, and `baseURL`
 * cannot be set by untrusted repo config.
 */
export interface ProviderConfig {
  /** A built-in preset name, or any string for a custom OpenAI/Anthropic base. */
  kind: ProviderKind | (string & {});
  /** Override the env var holding the API key (defaults to the preset's). */
  apiKeyEnv?: string;
  /** Override the preset's base URL (trusted config only). */
  baseURL?: string;
  /** Override the preset's default models. */
  models?: {
    orchestrator?: string;
    worker?: string;
  };
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  kind: "anthropic",
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

export class UnknownProviderError extends Error {
  constructor(kind: string) {
    super(
      `Unknown provider "${kind}". Known providers: ${listProviders().join(", ")}. ` +
        `For a custom endpoint, set kind = "openai" (or "anthropic") and override baseURL + apiKeyEnv.`,
    );
    this.name = "UnknownProviderError";
  }
}

/**
 * Builds the provider and resolves models by role. The secrets broker boundary:
 * the key is read here from the environment and handed only to the adapter —
 * the agent loop and tools never see it.
 */
export class ProviderRouter {
  readonly provider: ModelProvider;
  readonly kind: string;
  readonly label: string;
  private readonly models: { orchestrator: string; worker?: string };

  constructor(config: ProviderConfig) {
    const preset = resolvePreset(config.kind);
    this.kind = config.kind;
    this.label = preset.label;

    const baseURL = config.baseURL ?? preset.baseURL;
    this.models = {
      orchestrator: config.models?.orchestrator ?? preset.models.orchestrator,
      worker: config.models?.worker ?? preset.models.worker,
    };

    switch (preset.transport) {
      case "anthropic":
        this.provider = new AnthropicProvider({
          apiKey: requireKey(config.apiKeyEnv ?? preset.apiKeyEnv),
          defaultModel: this.models.orchestrator,
          baseURL,
        });
        break;
      case "openai":
        this.provider = new OpenAIProvider({
          apiKey: requireKey(config.apiKeyEnv ?? preset.apiKeyEnv),
          defaultModel: this.models.orchestrator,
          baseURL,
          prices: preset.prices,
        });
        break;
      case "ollama":
        // Local: no key required, no spend.
        this.provider = new OllamaProvider({
          defaultModel: this.models.orchestrator,
          baseURL,
        });
        break;
    }
  }

  modelFor(role: AgentRole): string {
    if (role === "worker") {
      return this.models.worker ?? this.models.orchestrator;
    }
    return this.models.orchestrator;
  }
}

function resolvePreset(kind: string): ProviderPreset {
  if (!isKnownProvider(kind)) throw new UnknownProviderError(kind);
  return PROVIDER_PRESETS[kind];
}

/**
 * Resolve the provider's API key through the {@link SecretBroker} — the single
 * env-reading boundary (§9). The broker redacts itself everywhere, so the key
 * is handed only to the adapter and never enters config, logs, or the agent.
 */
function requireKey(envName: string | undefined): string {
  if (!envName) throw new MissingApiKeyError("the provider's API key env var");
  const broker = new SecretBroker(envName);
  if (!broker.has()) throw new MissingApiKeyError(envName);
  return broker.resolve();
}
