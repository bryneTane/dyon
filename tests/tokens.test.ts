import { describe, expect, it } from "vitest";
import { subtractTokens, ZERO_TOKENS } from "@/lib/domain/tokens";

describe("subtractTokens", () => {
  it("turns two running totals into one turn's usage", () => {
    const before = { input: 100, cacheRead: 40, cacheWrite: 10, output: 30, reasoning: 5 };
    const after = { input: 250, cacheRead: 140, cacheWrite: 10, output: 80, reasoning: 25 };
    expect(subtractTokens(after, before)).toEqual({
      input: 150,
      cacheRead: 100,
      cacheWrite: 0,
      output: 50,
      reasoning: 20,
    });
  });

  it("is the identity against zero, for the first turn", () => {
    const totals = { input: 7, cacheRead: 1, cacheWrite: 2, output: 3, reasoning: 0 };
    expect(subtractTokens(totals, ZERO_TOKENS)).toEqual(totals);
  });
});
