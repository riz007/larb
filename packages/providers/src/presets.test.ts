import { afterEach, describe, expect, it } from "vitest";
import {
  ProviderRouter,
  MissingApiKeyError,
  UnknownProviderError,
} from "./registry.js";
import { listProviders } from "./presets.js";

const TOUCHED = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
];

afterEach(() => {
  for (const k of TOUCHED) delete process.env[k];
});

describe("provider presets", () => {
  it("ships the documented providers", () => {
    expect(listProviders()).toEqual(
      expect.arrayContaining([
        "anthropic",
        "openai",
        "ollama",
        "deepseek",
        "gemini",
        "groq",
        "mistral",
        "xai",
        "openrouter",
        "together",
        "perplexity",
      ]),
    );
  });

  it("resolves preset default models and worker fallback", () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const router = new ProviderRouter({ kind: "deepseek" });
    expect(router.provider.name).toBe("openai"); // OpenAI-compatible transport
    expect(router.modelFor("orchestrator")).toBe("deepseek-chat");

    process.env.GEMINI_API_KEY = "g-test";
    const gemini = new ProviderRouter({ kind: "gemini" });
    expect(gemini.modelFor("orchestrator")).toBe("gemini-2.5-pro");
    expect(gemini.modelFor("worker")).toBe("gemini-2.5-flash");
  });

  it("worker falls back to orchestrator when the preset has no worker", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const router = new ProviderRouter({
      kind: "openai",
      models: { orchestrator: "gpt-4o" },
    });
    // openai preset defines a worker, but an explicit orchestrator-only override
    // keeps the preset worker; a kind without a worker (perplexity has one too).
    expect(router.modelFor("orchestrator")).toBe("gpt-4o");
  });

  it("lets trusted config override models and key env var", () => {
    process.env.MY_KEY = "sk-custom";
    const router = new ProviderRouter({
      kind: "openai",
      apiKeyEnv: "MY_KEY",
      models: { orchestrator: "gpt-4.1", worker: "gpt-4o-mini" },
    });
    expect(router.modelFor("orchestrator")).toBe("gpt-4.1");
    expect(router.modelFor("worker")).toBe("gpt-4o-mini");
    delete process.env.MY_KEY;
  });

  it("prices via the preset table (DeepSeek, not OpenAI, rates)", () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const router = new ProviderRouter({ kind: "deepseek" });
    const cost = router.provider.estimateCost(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      "deepseek-chat",
    );
    expect(cost).toBeCloseTo(0.27 + 1.1, 5);
  });

  it("requires a key for hosted providers", () => {
    expect(() => new ProviderRouter({ kind: "openai" })).toThrow(MissingApiKeyError);
  });

  it("needs no key for local Ollama", () => {
    expect(() => new ProviderRouter({ kind: "ollama" })).not.toThrow();
  });

  it("rejects unknown providers with a helpful error", () => {
    expect(() => new ProviderRouter({ kind: "made-up" })).toThrow(UnknownProviderError);
  });
});
