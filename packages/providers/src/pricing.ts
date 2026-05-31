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

export function estimateCost(usage: TokenUsage, model: string): number {
  const price = priceFor(model);
  return (
    (usage.inputTokens / 1_000_000) * price.inputPerM +
    (usage.outputTokens / 1_000_000) * price.outputPerM
  );
}
