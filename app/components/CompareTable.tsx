import { ANTHROPIC_PRICES, OPENAI_PRICES } from "@/lib/domain/pricing";
import type { RunTurnResult } from "@/lib/domain/types";
import { formatMs, formatTokens, formatUsd } from "./format";
import { Origin, ORIGINS, type OriginKind } from "./Origin";

interface Metric {
  label: string;
  origin: OriginKind;
  detail: string;
  pick: (r: RunTurnResult) => number | null;
  format: (n: number) => string;
}

const count = String;

const METRICS: Metric[] = [
  { label: "Time", origin: "M", detail: "Wall-clock time of the agent call.", pick: (r) => r.wallMs, format: formatMs },
  {
    label: "Cost",
    origin: "D",
    detail: "Reported tokens x published list prices, the same method for every agent.",
    pick: (r) => r.cost.computedUsd,
    format: formatUsd,
  },
  {
    label: "Agent's own cost",
    origin: "R",
    detail: "Claude Code reports a cost; Codex reports none.",
    pick: (r) => r.cost.reportedUsd,
    format: formatUsd,
  },
  {
    label: "Input tokens",
    origin: "R",
    detail: "Including cache reads and cache writes.",
    pick: (r) => r.tokens?.input ?? null,
    format: formatTokens,
  },
  {
    label: "Cache reads",
    origin: "R",
    detail: "Input tokens served from the prompt cache.",
    pick: (r) => r.tokens?.cacheRead ?? null,
    format: formatTokens,
  },
  {
    label: "Cache writes",
    origin: "R",
    detail: "Input tokens written to the prompt cache.",
    pick: (r) => r.tokens?.cacheWrite ?? null,
    format: formatTokens,
  },
  {
    label: "Output tokens",
    origin: "R",
    detail: "Including reasoning.",
    pick: (r) => r.tokens?.output ?? null,
    format: formatTokens,
  },
  {
    label: "Reasoning tokens",
    origin: "R",
    detail: "Part of the output tokens.",
    pick: (r) => r.tokens?.reasoning ?? null,
    format: formatTokens,
  },
  {
    label: "Commands",
    origin: "R",
    detail: "Shell commands the agent ran.",
    pick: (r) => r.counts.commands,
    format: count,
  },
  {
    label: "File reads",
    origin: "R",
    detail: "Claude Code reads files with a tool; Codex reads them with shell commands, counted as commands.",
    pick: (r) => r.counts.fileReads,
    format: count,
  },
  {
    label: "File edits",
    origin: "R",
    detail: "Claude Code edits files with a tool; Codex often writes them with shell commands, counted as commands.",
    pick: (r) => r.counts.fileEdits,
    format: count,
  },
  {
    label: "Web searches and fetches",
    origin: "R",
    detail: "Web actions the agent reported.",
    pick: (r) => r.counts.webSearches,
    format: count,
  },
  {
    label: "Other tool calls",
    origin: "R",
    detail: "Planning, sub-agents and other tools.",
    pick: (r) => r.counts.otherTools,
    format: count,
  },
  {
    label: "Failed actions",
    origin: "R",
    detail: "Actions the agent marked as failed.",
    pick: (r) => r.counts.failedActions,
    format: count,
  },
];

export interface Column {
  id: string;
  label: string;
  slot: number;
  result?: RunTurnResult;
}

/** Every metric of a turn, one column per run, each value marked with where it comes from. */
export function CompareTable({ columns }: { columns: Column[] }) {
  const notes = [...new Set(columns.flatMap((c) => (c.result ? unpricedNotes(c.result) : [])))];
  return (
    <div className="compare">
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            {columns.map((c) => (
              <th key={c.id} className={`slot-${c.slot}`}>
                <span className="dot" /> {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => (
            <tr key={m.label}>
              <th title={m.detail}>
                {m.label}
                <Origin kind={m.origin} detail={m.detail} />
              </th>
              {columns.map((c) => {
                const value = c.result ? m.pick(c.result) : null;
                return (
                  <td key={c.id} className={value === null ? "muted" : ""}>
                    {!c.result ? "…" : value === null ? "unknown" : m.format(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="legend">
        {(Object.keys(ORIGINS) as OriginKind[]).map((k) => (
          <span key={k}>
            <b>{k}</b> {ORIGINS[k]}
          </span>
        ))}
        <span>
          List prices from{" "}
          <a href={ANTHROPIC_PRICES.source} target="_blank" rel="noreferrer">
            Anthropic
          </a>{" "}
          (read {ANTHROPIC_PRICES.readOn}) and{" "}
          <a href={OPENAI_PRICES.source} target="_blank" rel="noreferrer">
            OpenAI
          </a>{" "}
          (read {OPENAI_PRICES.readOn}).
        </span>
        {notes.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
    </div>
  );
}

function unpricedNotes(r: RunTurnResult): string[] {
  const notes: string[] = [];
  if (r.cost.unpriced.length) notes.push(`No published price for ${r.cost.unpriced.join(", ")}: cost unknown.`);
  if (r.cost.unpricedWebActions)
    notes.push("Codex web actions are not included in its cost: it does not report which ones were billed.");
  return notes;
}
