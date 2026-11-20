"use client";

import { useEffect, useState } from "react";
import type { HistoryEntry } from "@/lib/domain/types";
import type { ScoreboardRow } from "@/lib/domain/scoreboard";
import { useCatalog } from "./naming";
import { competitorLabel, VENDOR_LABELS } from "@/lib/domain/catalog";
import { formatMs, formatPct, formatTokens, formatUsd } from "./format";

interface Data {
  scoreboard: ScoreboardRow[];
  entries: HistoryEntry[];
}

export interface TaskSetup {
  prompt: string;
  check: string | null;
}

export function Scoreboard({ onClose, onRunAgain }: { onClose: () => void; onRunAgain: (task: TaskSetup) => void }) {
  const catalog = useCatalog();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/history")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel" role="dialog" aria-label="Scoreboard" onClick={(e) => e.stopPropagation()}>
        <header className="panel-header">
          <span className="panel-title">Scoreboard</span>
          <span className="spacer" />
          <button className="text-button" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="muted">
          Every first-turn run recorded by this app, across all tasks (follow-ups are not independent tasks, so they are
          listed below but not counted). A single comparison is an observation; a verdict needs many tasks. Pass rates
          come from your check commands, with a 95% range. While the ranges of two agents overlap, the data does not yet
          show a difference.
        </p>
        {error && <div className="error-box">Could not load history: {error}</div>}
        {!data && !error && (
          <div className="empty">
            <span className="spinner" /> Loading history
          </div>
        )}
        {data && (
          <>
            <table className="grid">
              <thead>
                <tr>
                  <th>Competitor</th>
                  <th>Runs</th>
                  <th>Check passed</th>
                  <th>95% range</th>
                  <th>Median time</th>
                  <th>Median output tokens</th>
                  <th>Median cost</th>
                  <th>Total cost</th>
                </tr>
              </thead>
              <tbody>
                {data.scoreboard.map((row) => (
                  <tr key={row.key}>
                    <th>{competitorLabel(row.spec, catalog)}</th>
                    <td>{row.runs}</td>
                    <td>{row.checked ? `${row.passed}/${row.checked}` : "–"}</td>
                    <td>{row.interval ? `${formatPct(row.interval[0])} to ${formatPct(row.interval[1])}` : "–"}</td>
                    <td>{row.medianWallMs !== null ? formatMs(row.medianWallMs) : "–"}</td>
                    <td>{row.medianOutputTokens !== null ? formatTokens(row.medianOutputTokens) : "–"}</td>
                    <td>
                      {row.medianCostUsd !== null ? (
                        formatUsd(row.medianCostUsd)
                      ) : (
                        <span className="muted">not reported</span>
                      )}
                    </td>
                    <td>
                      {row.totalCostUsd !== null ? (
                        formatUsd(row.totalCostUsd)
                      ) : (
                        <span className="muted">not reported</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h4>Recent runs</h4>
            {data.entries.length === 0 && <div className="muted">Nothing recorded yet.</div>}
            <ul className="history">
              {data.entries.map((e, i) => (
                <li key={i}>
                  <span title={e.requestedModel}>
                    {VENDOR_LABELS[e.vendor]}
                    {e.runIndex > 1 ? ` #${e.runIndex}` : ""}
                  </span>
                  <span className="history-prompt" title={e.prompt}>
                    {e.prompt}
                  </span>
                  <span className={e.checkPassed === null ? "muted" : e.checkPassed ? "ok" : "bad"}>
                    {e.checkPassed === null ? "no check" : e.checkPassed ? "passed" : "failed"}
                  </span>
                  <span>{formatMs(e.wallMs)}</span>
                  <span>{e.costUsd !== null ? formatUsd(e.costUsd) : "–"}</span>
                  <button
                    className="text-button"
                    onClick={() => onRunAgain({ prompt: e.prompt, check: e.check })}
                    title="Prefill the composer with this task"
                  >
                    Run again
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
