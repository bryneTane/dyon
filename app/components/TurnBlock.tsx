import { CheckCircle2, CircleSlash, Loader2, XCircle } from "lucide-react";
import { competitorLabel, type Catalog } from "@/lib/domain/catalog";
import type { ComparisonInfo, Outcome, TimelineItem } from "@/lib/domain/types";
import { Timeline } from "./Timeline";

export interface RunEnd {
  outcome: Outcome;
  wallMs: number;
}

/** One column per run, side by side, each with its agent, its status and its steps. */
export function TurnBlock({
  info,
  items,
  ends,
}: {
  info: ComparisonInfo;
  items: Record<string, TimelineItem[]>;
  ends: Record<string, RunEnd>;
}) {
  return (
    <div className="runs">
      {info.runs.map((run) => {
        const competitor = info.competitors.find((c) => c.id === run.competitorId)!;
        return (
          <section key={run.runId} className={`run slot-${competitor.slot}`}>
            <header>
              <span className="dot" />
              <strong>{competitorLabel(competitor, EMPTY_CATALOG)}</strong>
              <RunStatus end={ends[run.runId]} />
            </header>
            <Timeline items={items[run.runId] ?? []} />
          </section>
        );
      })}
    </div>
  );
}

// Model labels need the agents' catalog, which the page does not load yet: the model id is shown instead.
const EMPTY_CATALOG: Catalog = { claude: { models: [] }, codex: { models: [] } };

function RunStatus({ end }: { end?: RunEnd }) {
  if (!end)
    return (
      <span className="status">
        <Loader2 size={14} className="spin" /> Running
      </span>
    );
  const seconds = `${(end.wallMs / 1000).toFixed(1)} s`;
  switch (end.outcome.status) {
    case "completed":
      return (
        <span className="status ok">
          <CheckCircle2 size={14} /> Completed · {seconds}
        </span>
      );
    case "aborted":
      return (
        <span className="status">
          <CircleSlash size={14} /> Stopped · {seconds}
        </span>
      );
    case "error":
      return (
        <span className="status bad" title={end.outcome.detail}>
          <XCircle size={14} /> Failed · {seconds}
        </span>
      );
  }
}
