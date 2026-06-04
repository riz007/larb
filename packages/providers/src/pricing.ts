import type { TokenUsage } from "@larb/governors";

/** USD per 1M tokens. Approximate published Anthropic list prices. */
export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
}

const ANTHROPIC_PRICES: Array<{ match: RegExp; price: ModelPrice }> = [
  { match: /opus/i, price: { inputPerM: 15, outputPerM: 75 } },
  { match: /sonnet/i, price: { inputPerM: 3, outputPerM: 15 } },
  { match: /haiku/i, price: { inputPerM: 1, outputPerM: 5 } },
];

const FALLBACK: ModelPrice = { inputPerM: 3, outputPerM: 15 };

export function priceFor(model: string): ModelPrice {
  return ANTHROPIC_PRICES.find((p) => p.match.test(model))?.price ?? FALLBACK;
}

/** Anthropic prompt-cache multipliers: reads are cheap, writes carry a premium. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export function estimateCost(usage: TokenUsage, model: string): number {
  const price = priceFor(model);
  const inputPerToken = price.inputPerM / 1_000_000;
  return (
    usage.inputTokens * inputPerToken +
    (usage.cacheReadTokens ?? 0) * inputPerToken * CACHE_READ_MULTIPLIER +
    (usage.cacheWriteTokens ?? 0) * inputPerToken * CACHE_WRITE_MULTIPLIER +
    (usage.outputTokens / 1_000_000) * price.outputPerM
  );
}
