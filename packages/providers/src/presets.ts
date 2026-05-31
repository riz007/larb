/**
 * Provider presets — the model-agnostic registry.
 *
 * Each row bundles everything needed to talk to a provider: which wire
 * `transport` to use, the default `baseURL`, the env var holding the key, the
 * default orchestrator/worker models, and an approximate price table for the
 * cost governor. No provider is privileged in the codebase — adding one is a
 * new row here, not new logic.
 *
 * The key insight: most providers (DeepSeek, Gemini, Groq, Mistral, xAI,
 * OpenRouter, Together, Perplexity, …) expose an OpenAI-compatible Chat
 * Completions API, so they all reuse the `openai` transport with a different
 * `baseURL`. Anthropic and Ollama have their own transports.
 */

/** The three wire formats Larb implements an adapter for. */
export type Transport = "anthropic" | "openai" | "ollama";

/** USD per 1M tokens, matched against the model id by regex (first match wins). */
export interface PriceEntry {
  match: RegExp;
  inputPerM: number;
  outputPerM: number;
}

export interface ProviderPreset {
  /** Which adapter speaks to this provider. */
  transport: Transport;
  /** Default API base URL. Omitted for transports with a built-in default. */
  baseURL?: string;
  /** Env var holding the API key. Omitted for local providers (no key). */
  apiKeyEnv?: string;
  /** Default models by role; worker falls back to orchestrator when unset. */
  models: { orchestrator: string; worker?: string };
  /** Approximate prices for cost accounting; falls back to a generic estimate. */
  prices?: PriceEntry[];
  /** Human-readable label for help text and the TUI. */
  label: string;
}

/**
 * The built-in provider table. Users can also point any OpenAI- or
 * Anthropic-compatible endpoint at Larb by choosing `kind = "openai"` (or
 * `"anthropic"`) and overriding `baseURL` + `apiKeyEnv` in trusted config.
 */
export const PROVIDER_PRESETS = {
  anthropic: {
    transport: "anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    label: "Anthropic",
    models: { orchestrator: "claude-opus-4-8", worker: "claude-haiku-4-5-20251001" },
    prices: [
      { match: /opus/i, inputPerM: 15, outputPerM: 75 },
      { match: /sonnet/i, inputPerM: 3, outputPerM: 15 },
      { match: /haiku/i, inputPerM: 1, outputPerM: 5 },
    ],
  },

  openai: {
    transport: "openai",
    baseURL: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    label: "OpenAI",
    models: { orchestrator: "gpt-4o", worker: "gpt-4o-mini" },
    prices: [
      { match: /gpt-4o-mini/i, inputPerM: 0.15, outputPerM: 0.6 },
      { match: /gpt-4o/i, inputPerM: 2.5, outputPerM: 10 },
      { match: /gpt-4\.1-mini/i, inputPerM: 0.4, outputPerM: 1.6 },
      { match: /gpt-4\.1/i, inputPerM: 2, outputPerM: 8 },
      { match: /^o[0-9]/i, inputPerM: 15, outputPerM: 60 },
    ],
  },

  // Local, offline, no key, no spend.
  ollama: {
    transport: "ollama",
    baseURL: "http://localhost:11434",
    label: "Ollama (local)",
    models: { orchestrator: "llama3.1" },
  },

  // DeepSeek's API is OpenAI-compatible at this base.
  deepseek: {
    transport: "openai",
    baseURL: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    label: "DeepSeek",
    models: { orchestrator: "deepseek-chat", worker: "deepseek-chat" },
    prices: [
      { match: /reasoner/i, inputPerM: 0.55, outputPerM: 2.19 },
      { match: /chat/i, inputPerM: 0.27, outputPerM: 1.1 },
    ],
  },

  // Google Gemini via its OpenAI-compatibility layer.
  gemini: {
    transport: "openai",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnv: "GEMINI_API_KEY",
    label: "Google Gemini",
    models: { orchestrator: "gemini-2.5-pro", worker: "gemini-2.5-flash" },
    prices: [
      { match: /flash-lite/i, inputPerM: 0.1, outputPerM: 0.4 },
      { match: /flash/i, inputPerM: 0.3, outputPerM: 2.5 },
      { match: /pro/i, inputPerM: 1.25, outputPerM: 10 },
    ],
  },

  // Groq — fast OpenAI-compatible inference for open models.
  groq: {
    transport: "openai",
    baseURL: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    label: "Groq",
    models: { orchestrator: "llama-3.3-70b-versatile", worker: "llama-3.1-8b-instant" },
    prices: [
      { match: /8b/i, inputPerM: 0.05, outputPerM: 0.08 },
      { match: /70b/i, inputPerM: 0.59, outputPerM: 0.79 },
    ],
  },

  mistral: {
    transport: "openai",
    baseURL: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    label: "Mistral",
    models: { orchestrator: "mistral-large-latest", worker: "mistral-small-latest" },
    prices: [
      { match: /small/i, inputPerM: 0.2, outputPerM: 0.6 },
      { match: /large/i, inputPerM: 2, outputPerM: 6 },
    ],
  },

  // xAI Grok.
  xai: {
    transport: "openai",
    baseURL: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY",
    label: "xAI Grok",
    models: { orchestrator: "grok-4", worker: "grok-3-mini" },
    prices: [
      { match: /mini/i, inputPerM: 0.3, outputPerM: 0.5 },
      { match: /grok/i, inputPerM: 3, outputPerM: 15 },
    ],
  },

  // OpenRouter — one key, many models. Prices vary per model, so fall back to
  // the generic estimate; set explicit models like "anthropic/claude-3.7-sonnet".
  openrouter: {
    transport: "openai",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    label: "OpenRouter",
    models: { orchestrator: "anthropic/claude-3.7-sonnet", worker: "openai/gpt-4o-mini" },
  },

  together: {
    transport: "openai",
    baseURL: "https://api.together.xyz/v1",
    apiKeyEnv: "TOGETHER_API_KEY",
    label: "Together AI",
    models: {
      orchestrator: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      worker: "meta-llama/Llama-3.1-8B-Instruct-Turbo",
    },
  },

  perplexity: {
    transport: "openai",
    baseURL: "https://api.perplexity.ai",
    apiKeyEnv: "PERPLEXITY_API_KEY",
    label: "Perplexity",
    models: { orchestrator: "sonar-pro", worker: "sonar" },
  },
} satisfies Record<string, ProviderPreset>;

/** The set of built-in provider names. */
export type ProviderKind = keyof typeof PROVIDER_PRESETS;

export function isKnownProvider(kind: string): kind is ProviderKind {
  return Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, kind);
}

export function listProviders(): ProviderKind[] {
  return Object.keys(PROVIDER_PRESETS) as ProviderKind[];
}
