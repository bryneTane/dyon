"use client";

import { useState } from "react";
import { Check, EyeOff, FileText, LoaderCircle, Pencil } from "lucide-react";
import { competitorLabel } from "@/lib/domain/catalog";
import type { ComparisonInfo, Verdict } from "@/lib/domain/types";
import { slotClass } from "./competitors";
import { useCatalog, useNaming } from "./naming";

const OTHER: Record<string, string> = { tie: "Tie", all_bad: "All bad" };

/** The user's judgment of the work: the one thing the metrics cannot measure. */
export function VerdictBox({
  comparison,
  verdict,
  onSave,
}: {
  comparison: ComparisonInfo;
  verdict: Verdict | null;
  onSave: (winner: string, note: string) => Promise<void>;
}) {
  const naming = useNaming(comparison);
  const catalog = useCatalog();
  const [editing, setEditing] = useState(verdict === null);
  const [winner, setWinner] = useState<string | null>(verdict?.winner ?? null);
  const [note, setNote] = useState(verdict?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const winnerOf = (id: string) => comparison.competitors.find((c) => c.id === id);

  async function save() {
    if (!winner) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(winner, note);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const reportLink = (
    <a className="text-button" href={`/report/${comparison.id}`} target="_blank" rel="noreferrer">
      <FileText size={14} /> Open the report
    </a>
  );

  if (verdict && !editing) {
    const c = winnerOf(verdict.winner);
    return (
      <div className="verdict done">
        <div className="verdict-line">
          <Check size={15} className="ok" />
          <span>
            Your verdict:{" "}
            {c ? (
              <span className={slotClass(c)}>
                <span className="dot" /> <strong>{competitorLabel(c, catalog)}</strong> did the better work
              </span>
            ) : (
              <strong>{OTHER[verdict.winner]}</strong>
            )}
          </span>
          {verdict.blind && (
            <span className="badge" title="The names were hidden when you judged">
              <EyeOff size={12} /> judged blind
            </span>
          )}
        </div>
        {verdict.note && <p className="verdict-note">{verdict.note}</p>}
        {comparison.blind && (
          <p className="muted small">
            Names revealed:{" "}
            {comparison.competitors.map((x, i) => (
              <span key={x.id}>
                {i > 0 && ", "}
                Competitor {x.id.toUpperCase()} was {competitorLabel(x, catalog)}
              </span>
            ))}
            .
          </p>
        )}
        <div className="verdict-actions">
          <button className="text-button" onClick={() => setEditing(true)}>
            <Pencil size={13} /> Change
          </button>
          {reportLink}
        </div>
      </div>
    );
  }

  return (
    <div className="verdict">
      <div className="verdict-title">Which one did the better work?</div>
      <p className="muted small">
        Metrics say who was faster and cheaper, not whose code is better. Read the changes and files, then judge.
        {naming.hidden && " Names stay hidden until you decide (an agent may still name itself in its messages)."}
      </p>
      <div className="verdict-options">
        {comparison.competitors.map((c) => (
          <button
            key={c.id}
            className={`chip ${slotClass(c)} ${winner === c.id ? "on" : ""}`}
            onClick={() => setWinner(c.id)}
            aria-pressed={winner === c.id}
          >
            <span className="dot" /> {naming.name(c)}
          </button>
        ))}
        {Object.entries(OTHER).map(([id, label]) => (
          <button
            key={id}
            className={`chip ${winner === id ? "on" : ""}`}
            onClick={() => setWinner(id)}
            aria-pressed={winner === id}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        className="verdict-input"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why? (optional, shown in the report)"
      />
      {error && <div className="error-box">{error}</div>}
      <div className="verdict-actions">
        <button className="primary" onClick={save} disabled={!winner || saving}>
          {saving && <LoaderCircle size={14} className="spin" />} Save verdict
        </button>
        {verdict && (
          <button className="text-button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
        <span className="spacer" />
        {reportLink}
      </div>
    </div>
  );
}
