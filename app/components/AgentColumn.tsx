"use client";

import { useEffect, useState } from "react";
import type { Competitor, ComparisonInfo, RunInfo, RunTurnResult, TimelineItem } from "@/lib/domain/types";
import { settingsLabel } from "@/lib/domain/catalog";
import { useCatalog, useNaming } from "./naming";
import { slotClass } from "./competitors";
import type { TurnView } from "./useComparison";
import { Timeline } from "./Timeline";
import { PatchView } from "./Code";
import { RunStatus } from "./RunStatus";
import { formatMs, formatTokens, formatUsd } from "./format";

export type Meta = Record<string, { model?: string; version?: string }>;

export function useElapsed(since: number, live: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [live]);
  return Math.max(0, now - since);
}

export function runState(
  result: RunTurnResult | undefined,
  turnDone: boolean,
): "running" | "pass" | "fail" | "done" | "error" {
  if (!result) return turnDone ? "error" : "running";
  if (result.outcome.status !== "completed") return "error";
  if (result.check) return result.check.passed ? "pass" : "fail";
  return "done";
}

export function liveCounts(items: TimelineItem[]) {
  const count = (kinds: TimelineItem["kind"][]) => items.filter((i) => kinds.includes(i.kind)).length;
  return {
    cmd: count(["command"]),
    edit: count(["file_edit"]),
    web: count(["web_search", "web_fetch"]),
    tool: count(["tool"]),
  };
}

function Changes({ result }: { result: RunTurnResult }) {
  if (!result.diff) return <div className="empty">Changes could not be read.</div>;
  const { files, patch, truncated } = result.diff;
  if (files.length === 0) return <div className="empty">No file changed during this turn.</div>;
  return (
    <div className="changes">
      <PatchView patch={patch} />
      {truncated && <div className="muted small">Patch truncated for display.</div>}
    </div>
  );
}

/** Dyon's cost (same method for every agent) and, when the agent reports one, its own figure as a cross-check. */
export function CostValue({ cost }: { cost: RunTurnResult["cost"] }) {
  const matches =
    cost.computedUsd !== null && cost.reportedUsd !== null && Math.abs(cost.computedUsd - cost.reportedUsd) < 0.000_01;
  const title = [
    "Reported tokens of this turn × published list prices (lib/pricing.ts).",
    cost.reportedUsd !== null
      ? `The agent's own figure: ${formatUsd(cost.reportedUsd)} (${matches ? "identical" : "different"}).`
      : "This agent reports no cost of its own.",
    cost.unpricedWebActions > 0
      ? `${cost.unpricedWebActions} web action(s) not priced: billing per action is not reported.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span title={title} className="has-tip">
      {cost.computedUsd !== null ? formatUsd(cost.computedUsd) : `no price for ${cost.unpriced.join(", ")}`}
      {cost.unpricedWebActions > 0 && <span className="warn"> +{cost.unpricedWebActions} web</span>}
      {matches && <span className="ok"> ✓</span>}
    </span>
  );
}

function RunSummary({ result }: { result: RunTurnResult }) {
  const t = result.tokens;
  return (
    <div className="run-summary">
      <RunStatus result={result} live={false} />
      <span className="num" title="Measured by Dyon around the agent call">
        {formatMs(result.wallMs)}
      </span>
      {t && (
        <span
          className="num"
          title={`Reported by the agent. Input ${t.input} (cached reads ${t.cacheRead}, cache writes ${t.cacheWrite}), output ${t.output} (reasoning ${t.reasoning}).`}
        >
          {formatTokens(t.input)} in · {formatTokens(t.output)} out
        </span>
      )}
      <span className="num">
        <CostValue cost={result.cost} />
      </span>
      {result.outcome.status === "error" && <div className="run-error">{result.outcome.detail}</div>}
    </div>
  );
}

/** Requested settings; flags it when the agent reports a different main model. */
export function ModelTag({
  competitor,
  reported,
  version,
}: {
  competitor: Competitor;
  reported?: string;
  version?: string;
}) {
  const catalog = useCatalog();
  const differs = reported && reported !== competitor.model;
  const title = [
    `Requested: ${competitor.model}${competitor.effort ? `, ${competitor.effort} effort` : ", default effort"}.`,
    reported ? `Reported by the agent: ${reported}.` : "",
    version ? `CLI ${version}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={`model-tag ${differs ? "warn" : "muted"}`} title={title}>
      {settingsLabel(competitor, catalog)}
      {differs ? ` (ran ${reported})` : ""}
    </span>
  );
}

export function AgentColumn(props: {
  comparison: ComparisonInfo;
  competitor: Competitor;
  runs: RunInfo[];
  turn: TurnView;
  meta: Meta;
  initialRunId?: string;
}) {
  const { comparison, competitor, runs, turn, meta, initialRunId } = props;
  const naming = useNaming(comparison);
  const [selected, setSelected] = useState(initialRunId ?? runs[0]?.runId);
  const [tab, setTab] = useState<"timeline" | "changes">("timeline");
  const run = runs.find((r) => r.runId === selected) ?? runs[0];
  const result = run ? turn.results[run.runId] : undefined;
  const live = !turn.done && !result;
  const elapsed = useElapsed(turn.startedAt, live);
  const info = run ? meta[run.runId] : undefined;
  const items = run ? (turn.items[run.runId] ?? []) : [];

  return (
    <section className={`column ${slotClass(competitor)}`}>
      <header className="column-head">
        <span className="dot" />
        <span className="column-name">{naming.vendor(competitor)}</span>
        {!naming.hidden && <ModelTag competitor={competitor} reported={info?.model} version={info?.version} />}
        <span className="spacer" />
        <span className="num">{live ? formatMs(elapsed) : result ? formatMs(result.wallMs) : ""}</span>
      </header>
      <nav className="tabs">
        {runs.length > 1 &&
          runs.map((r) => (
            <button
              key={r.runId}
              className={`run-tab ${r.runId === run?.runId ? "on" : ""}`}
              onClick={() => setSelected(r.runId)}
            >
              <span className={`state state-${runState(turn.results[r.runId], turn.done)}`} /> Run {r.index}
            </button>
          ))}
        {runs.length > 1 && <span className="bar-sep" />}
        <button className={tab === "timeline" ? "on" : ""} onClick={() => setTab("timeline")}>
          Timeline <span className="count">{items.length}</span>
        </button>
        <button className={tab === "changes" ? "on" : ""} onClick={() => setTab("changes")} disabled={!result}>
          Changes {result?.diff && <span className="count">{result.diff.files.length}</span>}
        </button>
      </nav>
      <div className="column-body">
        {tab === "timeline" && <Timeline items={items} live={live} />}
        {tab === "changes" && result && <Changes result={result} />}
      </div>
      {result && <RunSummary result={result} />}
    </section>
  );
}
