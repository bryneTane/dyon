import { describe, expect, it } from "vitest";
import { countActions, turnCost, turnTokens } from "@/lib/domain/metrics";
import type { Cumulative, TimelineItem } from "@/lib/domain/types";

describe("countActions", () => {
  it("counts each kind of action and the failed ones", () => {
    const items: TimelineItem[] = [
      { id: "1", kind: "message", text: "hi" },
      { id: "2", kind: "command", command: "ls", status: "ok" },
      { id: "3", kind: "command", command: "false", status: "failed" },
      { id: "4", kind: "file_read", path: "a.js", status: "ok" },
      { id: "5", kind: "file_edit", path: "a.js", change: "update", status: "ok" },
      { id: "6", kind: "web_search", query: "x", status: "ok" },
      { id: "7", kind: "web_fetch", url: "https://example.com", status: "failed" },
      { id: "8", kind: "tool", name: "Task", status: "ok" },
      { id: "9", kind: "reasoning", text: "thinking" },
    ] as TimelineItem[];
    expect(countActions(items)).toEqual({
      commands: 2,
      fileReads: 1,
      fileEdits: 1,
      webSearches: 2,
      otherTools: 1,
      failedActions: 2,
    });
  });
});

const totals = (input: number, output: number, computedUsd: number | null, reportedUsd: number | null): Cumulative => ({
  tokens: { input, cacheRead: input / 2, cacheWrite: 0, output, reasoning: 0 },
  reportedUsd,
  computedUsd,
  unpriced: [],
  unpricedWebActions: 0,
});

describe("turn usage from running totals", () => {
  it("takes the whole total on the first turn", () => {
    expect(turnTokens(totals(100, 10, 1, 1), null)).toEqual({
      input: 100,
      cacheRead: 50,
      cacheWrite: 0,
      output: 10,
      reasoning: 0,
    });
  });

  it("takes the difference on a later turn", () => {
    const before = totals(100, 10, 1, 1);
    const after = totals(300, 25, 2.5, 2.4);
    expect(turnTokens(after, before)).toEqual({ input: 200, cacheRead: 100, cacheWrite: 0, output: 15, reasoning: 0 });
    const cost = turnCost(after, before, 0);
    expect(cost.computedUsd).toBeCloseTo(1.5);
    expect(cost.reportedUsd).toBeCloseTo(1.4);
  });

  it("stays unknown when the agent reported nothing or gave no cost", () => {
    expect(turnTokens(null, totals(1, 1, 1, 1))).toBeNull();
    expect(turnCost(totals(1, 1, null, null), null, 3)).toEqual({
      computedUsd: null,
      reportedUsd: null,
      unpriced: [],
      unpricedWebActions: 3,
    });
  });
});
