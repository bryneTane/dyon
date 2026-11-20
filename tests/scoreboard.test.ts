import { describe, expect, it } from "vitest";
import { scoreboard } from "@/lib/domain/scoreboard";
import type { HistoryEntry } from "@/lib/domain/types";

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  at: "t",
  comparisonId: "c",
  turnIndex: 0,
  prompt: "p",
  vendor: "claude",
  requestedModel: "m",
  effort: null,
  check: null,
  runIndex: 1,
  model: "m",
  wallMs: 1000,
  tokens: null,
  costUsd: 0.1,
  outcome: "completed",
  checkPassed: null,
  ...over,
});

describe("scoreboard", () => {
  it("groups first turns by agent, requested model and effort", () => {
    const rows = scoreboard([
      entry({ wallMs: 1000, checkPassed: true }),
      entry({ wallMs: 3000, checkPassed: false, costUsd: 0.3 }),
      entry({ wallMs: 2000, checkPassed: null, costUsd: null }),
      entry({ effort: "high" }),
      entry({ vendor: "codex", requestedModel: "g" }),
      entry({ turnIndex: 1 }),
      entry({ outcome: "aborted" }),
    ]);
    expect(rows).toHaveLength(3);
    const first = rows[0];
    expect(first).toMatchObject({ runs: 3, checked: 2, passed: 1, medianWallMs: 2000, medianCostUsd: 0.2 });
    expect(first.totalCostUsd).toBeCloseTo(0.4);
    expect(first.interval![0]).toBeGreaterThan(0);
    expect(rows[1]).toMatchObject({ runs: 1, checked: 0, interval: null });
  });
});
