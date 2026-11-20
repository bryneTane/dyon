import { readFileSync } from "node:fs";
import type { ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { ANTHROPIC_PRICES, OPENAI_PRICES, priceClaude, priceCodex } from "@/lib/domain/pricing";

const lines = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

describe("priceClaude", () => {
  const result = lines("claude-hello.jsonl").find((m) => m.type === "result");
  const modelUsage = result.modelUsage as Record<string, ModelUsage>;

  it("reproduces the cost Claude Code reported for a real run", () => {
    const { usd, missing } = priceClaude(modelUsage);
    expect(missing).toEqual([]);
    expect(Math.abs(usd! - result.total_cost_usd) / result.total_cost_usd).toBeLessThan(0.01);
  });

  it("matches each model's own reported figure", () => {
    for (const [model, usage] of Object.entries(modelUsage))
      expect(priceClaude({ [model]: usage }).usd).toBeCloseTo(usage.costUSD, 9);
  });

  it("prices 1-hour cache writes at their own rate and web searches per call", () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
      cacheCreationEphemeral1hInputTokens: 400_000,
      webSearchRequests: 3,
    } as ModelUsage;
    // 600k at $5, 400k at $8, 3 searches at $0.01.
    expect(priceClaude({ "claude-opus-5-5": usage }).usd).toBeCloseTo(3 + 3.2 + 0.03, 9);
  });

  it("gives no cost, and names the model, when a price is unknown", () => {
    const usage = Object.values(modelUsage)[0];
    expect(priceClaude({ "claude-unknown": usage, ...modelUsage })).toEqual({ usd: null, missing: ["claude-unknown"] });
  });
});

describe("priceCodex", () => {
  const usage = lines("codex-hello.jsonl").find((e) => e.type === "turn.completed").usage;
  const tokens = {
    input: usage.input_tokens,
    cacheRead: usage.cached_input_tokens,
    cacheWrite: usage.cache_write_input_tokens,
    output: usage.output_tokens,
    reasoning: usage.reasoning_output_tokens,
  };

  it("prices uncached input, cache reads, cache writes and output separately", () => {
    const uncached = tokens.input - tokens.cacheRead - tokens.cacheWrite;
    const expected = (uncached * 2 + tokens.cacheRead * 0.1 + tokens.cacheWrite * 2.5 + tokens.output * 10) / 1e6;
    const { usd, missing } = priceCodex("gpt-6.2-sol", tokens);
    expect(missing).toEqual([]);
    expect(usd).toBeCloseTo(expected, 12);
  });

  it("bills cache writes as input when the model lists no write price", () => {
    const t = { input: 1_000_000, cacheRead: 0, cacheWrite: 1_000_000, output: 0, reasoning: 0 };
    expect(priceCodex("gpt-5.5", t).usd).toBe(5);
  });

  it("gives no cost for an unknown model", () => {
    expect(priceCodex("gpt-unknown", tokens)).toEqual({ usd: null, missing: ["gpt-unknown"] });
  });
});

describe("price tables", () => {
  it("say where and when they were read", () => {
    for (const table of [ANTHROPIC_PRICES, OPENAI_PRICES]) {
      expect(table.source).toMatch(/^https:\/\//);
      expect(table.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
