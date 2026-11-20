import { subtractTokens, ZERO_TOKENS } from "./tokens";
import type { ActionCounts, Cumulative, TimelineItem, Tokens, TurnCost } from "./types";

/**
 * A turn's actions by kind, from its timeline. Claude Code reads files with dedicated tools (fileReads);
 * Codex reads them through shell commands, counted as commands: the two counts are not comparable.
 */
export function countActions(items: TimelineItem[]): ActionCounts {
  const counts: ActionCounts = {
    commands: 0,
    fileReads: 0,
    fileEdits: 0,
    webSearches: 0,
    otherTools: 0,
    failedActions: 0,
  };
  for (const item of items) {
    switch (item.kind) {
      case "command":
        counts.commands++;
        break;
      case "file_read":
        counts.fileReads++;
        break;
      case "file_edit":
        counts.fileEdits++;
        break;
      case "web_search":
      case "web_fetch":
        counts.webSearches++;
        break;
      case "tool":
        counts.otherTools++;
        break;
    }
    if (item.kind !== "check" && item.status === "failed") counts.failedActions++;
  }
  return counts;
}

/** Agents report running totals for the whole session: one turn's usage is after minus before. */
export function turnTokens(after: Cumulative | null, before: Cumulative | null): Tokens | null {
  return after ? subtractTokens(after.tokens, before?.tokens ?? ZERO_TOKENS) : null;
}

/** One turn's cost, from running totals. `unpricedWebActions` is passed when the agent's searches are not priced. */
export function turnCost(after: Cumulative | null, before: Cumulative | null, unpricedWebActions: number): TurnCost {
  const delta = (a: number | null | undefined, b: number | null | undefined) => (a == null ? null : a - (b ?? 0));
  return {
    computedUsd: delta(after?.computedUsd, before?.computedUsd),
    reportedUsd: delta(after?.reportedUsd, before?.reportedUsd),
    unpriced: after?.unpriced ?? [],
    unpricedWebActions,
  };
}
