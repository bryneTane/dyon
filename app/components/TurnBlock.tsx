import { CheckCircle2, CircleSlash, Loader2, XCircle } from "lucide-react";
import { competitorLabel, type Catalog } from "@/lib/domain/catalog";
import type { ComparisonInfo, RunTurnResult, TurnRecord } from "@/lib/domain/types";
import { Timeline } from "./Timeline";

type RunEnd = Pick<RunTurnResult, "outcome" | "wallMs">;

/** One turn: its prompt, then one column per run, side by side, each with its agent, status and steps. */
export function TurnBlock({
  info,
  turn,
  catalog,
}: {
  info: ComparisonInfo;
  turn: TurnRecord;
  catalog: Catalog | null;
}) {
  return (
    <div className="turn">
      <p className="prompt">{turn.prompt}</p>
      {turn.error && <p className="error">{turn.error}</p>}
      <div className="runs">
        {info.runs.map((run) => {
          const competitor = info.competitors.find((c) => c.id === run.competitorId)!;
          return (
            <section key={run.runId} className={`run slot-${competitor.slot}`}>
              <header>
                <span className="dot" />
                <strong>{competitorLabel(competitor, catalog ?? NO_CATALOG)}</strong>
                <RunStatus end={turn.results[run.runId]} queued={turn.state === "queued"} />
              </header>
              <Timeline items={turn.items[run.runId] ?? []} />
            </section>
          );
        })}
      </div>
    </div>
  );
}

// Until the agents' catalog has loaded, models are shown by their id.
const NO_CATALOG: Catalog = { claude: { models: [] }, codex: { models: [] } };

function RunStatus({ end, queued }: { end?: RunEnd; queued: boolean }) {
  if (!end && queued)
    return (
      <span className="status">
        <Loader2 size={14} className="spin" /> Starting
      </span>
    );
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
