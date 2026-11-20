// Published list prices, to turn the tokens each agent reports into dollars with one method for every agent.
// Claude Code also reports a cost (`total_cost_usd`); its per-model figures say `costBasis: "list"`, and this
// module reproduces them exactly (tests/pricing.test.ts), which checks the method on real data.
import type { ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import type { Tokens } from "./types";

/** USD per million tokens, and USD per billed web search. */
export interface ModelPrice {
  input: number;
  cacheRead: number;
  /** Anthropic: 5-minute and 1-hour cache writes. */
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  /** OpenAI: cache write at the default 30-minute lifetime. */
  cacheWrite?: number;
  output: number;
  webSearch?: number;
}

export interface PriceTable {
  provider: string;
  source: string;
  readOn: string;
  models: Record<string, ModelPrice>;
  notes: string[];
}

export const ANTHROPIC_PRICES: PriceTable = {
  provider: "Anthropic",
  source: "https://platform.claude.com/docs/en/about-claude/pricing",
  readOn: "2026-11-20",
  models: {
    "claude-opus-5-5": { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20, webSearch: 0.01 },
    "claude-fable-5-2": { input: 8, cacheWrite5m: 10, cacheWrite1h: 16, cacheRead: 0.2, output: 40, webSearch: 0.01 },
    "claude-sonnet-5-5": { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10, webSearch: 0.01 },
    "claude-haiku-5-5": {
      input: 0.1,
      cacheWrite5m: 0.125,
      cacheWrite1h: 0.2,
      cacheRead: 0.01,
      output: 0.5,
      webSearch: 0.01,
    },
  },
  notes: [
    "Web search: $10 per 1,000 searches.",
    "Haiku 5.5 costs more for a request whose prompt exceeds 100,000 tokens; the rates here are for shorter prompts.",
  ],
};

export const OPENAI_PRICES: PriceTable = {
  provider: "OpenAI",
  source: "https://developers.openai.com/api/docs/pricing",
  readOn: "2026-11-20",
  models: {
    "gpt-6.2-sol": { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 },
    "gpt-6.2-astra": { input: 8, cacheRead: 0.4, cacheWrite: 10, output: 40 },
    "gpt-6.1-terra": { input: 1, cacheRead: 0.05, cacheWrite: 1.25, output: 5 },
    "gpt-6.1-sol": { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 },
    "gpt-6-astra": { input: 10, cacheRead: 1, cacheWrite: 12.5, output: 50 },
    "gpt-6-sol": { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 },
    "gpt-6-luna": { input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, output: 0.5 },
    "gpt-5.6-sol": { input: 4, cacheRead: 0.4, cacheWrite: 5, output: 20 },
    "gpt-5.6-terra": { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 12 },
    "gpt-5.6-luna": { input: 0.2, cacheRead: 0.02, cacheWrite: 0.25, output: 1.2 },
    // No cache write price listed for this model: writes are billed as ordinary input.
    "gpt-5.5": { input: 5, cacheRead: 0.5, output: 30 },
  },
  notes: [
    "Standard tier, prompts up to 272K input tokens (longer prompts cost more; Codex does not report each request's size).",
    "Cache writes at the 30-minute rate, the default lifetime for GPT-5.6 and later (https://developers.openai.com/api/docs/guides/prompt-caching).",
    "Web searches are not included: Codex reports search, open-page and find actions alike, without saying which were billed ($10 per 1,000 searches).",
    "Codex does not report which model it used: the requested model is priced.",
  ],
};

export interface Priced {
  /** Null when any model has no known price: never a guess. */
  usd: number | null;
  /** Models without a known price. */
  missing: string[];
}

const perMillion = (tokens: number, usdPerMillion: number) => (tokens * usdPerMillion) / 1_000_000;

/** Claude Code's running totals per model (the SDK's `modelUsage`). */
export function priceClaude(modelUsage: Record<string, ModelUsage>): Priced {
  let usd = 0;
  const missing: string[] = [];
  for (const [model, u] of Object.entries(modelUsage)) {
    const p = ANTHROPIC_PRICES.models[model];
    if (!p) {
      missing.push(model);
      continue;
    }
    const write1h = u.cacheCreationEphemeral1hInputTokens ?? 0;
    const write5m = u.cacheCreationInputTokens - write1h;
    usd +=
      perMillion(u.inputTokens, p.input) +
      perMillion(write5m, p.cacheWrite5m ?? p.input) +
      perMillion(write1h, p.cacheWrite1h ?? p.input) +
      perMillion(u.cacheReadInputTokens, p.cacheRead) +
      perMillion(u.outputTokens, p.output) +
      u.webSearchRequests * (p.webSearch ?? 0);
  }
  return { usd: missing.length ? null : usd, missing };
}

/** Codex's running totals. Its input count includes cache reads and cache writes. */
export function priceCodex(model: string, t: Tokens): Priced {
  const p = OPENAI_PRICES.models[model];
  if (!p) return { usd: null, missing: [model] };
  const uncached = t.input - t.cacheRead - t.cacheWrite;
  return {
    usd:
      perMillion(uncached, p.input) +
      perMillion(t.cacheRead, p.cacheRead) +
      perMillion(t.cacheWrite, p.cacheWrite ?? p.input) +
      perMillion(t.output, p.output),
    missing: [],
  };
}
