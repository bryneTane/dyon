import { competitorKey, type CompetitorSpec } from "./catalog";
import { median, wilson } from "./stats";
import type { HistoryEntry } from "./types";

/** One configuration (agent, requested model, effort) across every first-turn run recorded. */
export interface ScoreboardRow {
  key: string;
  spec: CompetitorSpec;
  runs: number;
  /** Runs that had a check, and how many passed it. */
  checked: number;
  passed: number;
  /** 95% Wilson interval of the pass rate, null without any check. */
  interval: [number, number] | null;
  medianWallMs: number | null;
  medianCostUsd: number | null;
  totalCostUsd: number | null;
  medianOutputTokens: number | null;
}

/**
 * Groups runs by configuration. Only first turns count: a follow-up depends on what came before, so it is
 * not an independent task. Stopped runs do not count either: they say nothing about the task.
 */
export function scoreboard(entries: HistoryEntry[]): ScoreboardRow[] {
  const groups = new Map<string, { spec: CompetitorSpec; rows: HistoryEntry[] }>();
  for (const e of entries) {
    if (e.turnIndex !== 0 || e.outcome === "aborted") continue;
    const spec: CompetitorSpec = { vendor: e.vendor, model: e.requestedModel, effort: e.effort };
    const key = competitorKey(spec);
    if (!groups.has(key)) groups.set(key, { spec, rows: [] });
    groups.get(key)!.rows.push(e);
  }
  return [...groups.entries()].map(([key, { spec, rows }]) => {
    const checked = rows.filter((e) => e.checkPassed !== null);
    const passed = checked.filter((e) => e.checkPassed).length;
    const costs = rows.map((e) => e.costUsd).filter((c): c is number => c !== null);
    return {
      key,
      spec,
      runs: rows.length,
      checked: checked.length,
      passed,
      interval: checked.length ? wilson(passed, checked.length) : null,
      medianWallMs: median(rows.map((e) => e.wallMs)),
      medianCostUsd: median(costs),
      totalCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
      medianOutputTokens: median(rows.flatMap((e) => (e.tokens ? [e.tokens.output] : []))),
    };
  });
}
