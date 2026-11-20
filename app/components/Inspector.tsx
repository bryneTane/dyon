"use client";

import { useEffect } from "react";
import { Columns2, X } from "lucide-react";
import type { ComparisonInfo } from "@/lib/domain/types";
import { competitorOf, runsOf, slotClass } from "./competitors";
import { useNaming } from "./naming";
import type { TurnView } from "./useComparison";
import { AgentColumn, type Meta } from "./AgentColumn";
import type { InspectTarget } from "./TurnBlock";

/** Right-hand panel: full detail of one run, or of every agent side by side. */
export function Inspector(props: {
  comparison: ComparisonInfo;
  turn: TurnView;
  meta: Meta;
  target: InspectTarget;
  onSelect: (target: InspectTarget) => void;
  onClose: () => void;
}) {
  const { comparison, turn, meta, target, onSelect, onClose } = props;
  const selectedRun = comparison.runs.find((r) => r.runId === target.runId);
  const naming = useNaming(comparison);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="inspector" aria-label="Inspector">
      <header className="inspector-head">
        <span className="inspector-title">{turn.index === 0 ? "Task" : `Follow-up ${turn.index}`}</span>
        <div className="segmented">
          <button
            className={target.runId === null ? "on" : ""}
            onClick={() => onSelect({ turnIndex: turn.index, runId: null })}
          >
            <Columns2 size={13} /> Side by side
          </button>
          {comparison.competitors.map((c) => {
            const first = runsOf(comparison, c)[0];
            return (
              <button
                key={c.id}
                className={`${slotClass(c)} ${selectedRun?.competitorId === c.id ? "on" : ""}`}
                onClick={() => first && onSelect({ turnIndex: turn.index, runId: first.runId })}
              >
                <span className="dot" /> {naming.name(c)}
              </button>
            );
          })}
        </div>
        <span className="spacer" />
        <button className="icon-button" onClick={onClose} title="Close (Esc)">
          <X size={16} />
        </button>
      </header>
      <div className="inspector-body">
        {target.runId === null || !selectedRun ? (
          <div
            className="columns"
            style={{ gridTemplateColumns: `repeat(${comparison.competitors.length}, minmax(0, 1fr))` }}
          >
            {comparison.competitors.map((c) => (
              <AgentColumn
                key={`${turn.index}-${c.id}`}
                comparison={comparison}
                competitor={c}
                runs={runsOf(comparison, c)}
                turn={turn}
                meta={meta}
              />
            ))}
          </div>
        ) : (
          <AgentColumn
            key={`${turn.index}-${selectedRun.runId}`}
            comparison={comparison}
            competitor={competitorOf(comparison, selectedRun)}
            runs={runsOf(comparison, competitorOf(comparison, selectedRun))}
            initialRunId={selectedRun.runId}
            turn={turn}
            meta={meta}
          />
        )}
      </div>
    </aside>
  );
}
