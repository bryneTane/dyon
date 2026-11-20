"use client";

import { ChevronRight, Columns2 } from "lucide-react";
import { RunStatus } from "./RunStatus";
import type { Competitor, ComparisonInfo, RunInfo, RunTurnResult } from "@/lib/domain/types";
import { useNaming } from "./naming";
import { runsOf, slotClass } from "./competitors";
import type { TurnView } from "./useComparison";
import { CompareTable } from "./CompareTable";
import { ModelTag, runState, useElapsed, type Meta } from "./AgentColumn";
import { StepIcon, stepSummary } from "./Timeline";
import { formatMs, formatUsd } from "./format";

export interface InspectTarget {
  turnIndex: number;
  /** null: all agents side by side. */
  runId: string | null;
}

function AgentCard(props: {
  comparison: ComparisonInfo;
  competitor: Competitor;
  runs: RunInfo[];
  turn: TurnView;
  meta: Meta;
  active: boolean;
  onInspect: (runId: string) => void;
}) {
  const { comparison, competitor, runs, turn, meta, active, onInspect } = props;
  const naming = useNaming(comparison);
  const first = runs[0];
  const results = runs.map((r) => turn.results[r.runId]);
  const live = !turn.done && results.some((r) => !r);
  const elapsed = useElapsed(turn.startedAt, live);
  const items = first ? (turn.items[first.runId] ?? []) : [];
  const last = [...items].reverse().find((i) => i.kind !== "reasoning" && i.kind !== "check");
  const single = runs.length === 1 ? results[0] : undefined;
  const info = first ? meta[first.runId] : undefined;
  const done = results.filter((r): r is RunTurnResult => Boolean(r));
  const actions = items.filter((i) => i.kind !== "message" && i.kind !== "reasoning").length;

  return (
    <button
      className={`card ${slotClass(competitor)} ${active ? "active" : ""}`}
      onClick={() => first && onInspect(first.runId)}
    >
      <div className="card-head">
        <span className="dot" />
        <span className="card-name">{naming.vendor(competitor)}</span>
        {!naming.hidden && (
          <span className="card-model">
            <ModelTag competitor={competitor} reported={info?.model} version={info?.version} />
          </span>
        )}
      </div>
      <div className="card-figures">
        <div>
          <div className="figure">
            {live || single ? formatMs(single ? single.wallMs : elapsed) : `${done.length}/${runs.length}`}
          </div>
          <div className="figure-label">{live || single ? "time" : "runs done"}</div>
        </div>
        <div>
          <div className="figure">{single?.cost.computedUsd != null ? formatUsd(single.cost.computedUsd) : "–"}</div>
          <div className="figure-label">cost</div>
        </div>
        <div>
          <div className="figure">{actions}</div>
          <div className="figure-label">actions</div>
        </div>
      </div>
      {runs.length > 1 ? (
        <div className="card-runs">
          {runs.map((r) => (
            <span
              key={r.runId}
              className={`state state-${runState(turn.results[r.runId], turn.done)}`}
              title={`Run ${r.index}`}
            />
          ))}
          <span className="muted">{runs.length} runs, figures of run 1</span>
        </div>
      ) : (
        <RunStatus result={single} live={live} />
      )}
      <div className="card-last">
        {last ? (
          <>
            <StepIcon item={last} size={13} />
            <span className="card-last-text">{stepSummary(last)}</span>
          </>
        ) : (
          <span className="muted">{live ? "Starting…" : "No activity"}</span>
        )}
        <ChevronRight size={14} className="card-chevron" />
      </div>
    </button>
  );
}

export function TurnBlock(props: {
  comparison: ComparisonInfo | null;
  turn: TurnView;
  meta: Meta;
  inspect: InspectTarget | null;
  onInspect: (target: InspectTarget) => void;
}) {
  const { comparison, turn, meta, inspect, onInspect } = props;
  const hasResults = Object.keys(turn.results).length > 0;
  const activeHere = inspect?.turnIndex === turn.index;
  return (
    <section className="turn">
      <div className="user-msg">
        <div className="user-text">{turn.prompt}</div>
        <div className="user-meta">
          {turn.index === 0 ? "Task" : "Follow-up"} ·{" "}
          {new Date(turn.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      {comparison && (
        <>
          <div
            className="cards"
            style={{ gridTemplateColumns: `repeat(${comparison.competitors.length}, minmax(0, 1fr))` }}
          >
            {comparison.competitors.map((competitor) => {
              const runs = runsOf(comparison, competitor);
              return (
                <AgentCard
                  key={competitor.id}
                  comparison={comparison}
                  competitor={competitor}
                  runs={runs}
                  turn={turn}
                  meta={meta}
                  active={activeHere && runs.some((r) => r.runId === inspect?.runId)}
                  onInspect={(runId) => onInspect({ turnIndex: turn.index, runId })}
                />
              );
            })}
          </div>
          <button
            className={`side-by-side ${activeHere && inspect?.runId === null ? "on" : ""}`}
            onClick={() => onInspect({ turnIndex: turn.index, runId: null })}
          >
            <Columns2 size={14} /> View side by side
          </button>
        </>
      )}
      {turn.error && <div className="error-box">{turn.error}</div>}
      {comparison && hasResults && <CompareTable comparison={comparison} turn={turn} />}
    </section>
  );
}
