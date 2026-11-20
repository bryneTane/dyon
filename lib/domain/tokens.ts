import type { Tokens } from "./types";

export const ZERO_TOKENS: Tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };

/** One turn's usage from two running totals. */
export function subtractTokens(after: Tokens, before: Tokens): Tokens {
  return {
    input: after.input - before.input,
    cacheRead: after.cacheRead - before.cacheRead,
    cacheWrite: after.cacheWrite - before.cacheWrite,
    output: after.output - before.output,
    reasoning: after.reasoning - before.reasoning,
  };
}
