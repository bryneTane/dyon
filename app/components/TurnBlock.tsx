import { competitorLabel, type Catalog } from "@/lib/domain/catalog";
import type { ComparisonInfo, TurnRecord } from "@/lib/domain/types";
import { CompareTable } from "./CompareTable";
import { RunStatus } from "./RunStatus";
import { Timeline } from "./Timeline";

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
  const labels = new Map(info.competitors.map((c) => [c.id, competitorLabel(c, catalog ?? NO_CATALOG)]));
  const columns = info.runs.map((run) => {
    const competitor = info.competitors.find((c) => c.id === run.competitorId)!;
    return { id: run.runId, label: labels.get(competitor.id)!, slot: competitor.slot, result: turn.results[run.runId] };
  });
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
                <RunStatus result={turn.results[run.runId]} queued={turn.state === "queued"} />
              </header>
              <Timeline items={turn.items[run.runId] ?? []} />
            </section>
          );
        })}
      </div>
      {columns.some((c) => c.result) && <CompareTable columns={columns} />}
    </div>
  );
}

// Until the agents' catalog has loaded, models are shown by their id.
const NO_CATALOG: Catalog = { claude: { models: [] }, codex: { models: [] } };
