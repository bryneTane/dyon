"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import type { Competitor, ComparisonInfo, RunTurnResult } from "@/lib/domain/types";
import { runsOf, slotClass } from "./competitors";
import { useNaming } from "./naming";
import { median, range, wilson } from "@/lib/domain/stats";
import type { TurnView } from "./useComparison";
import { formatMs, formatPct, formatTokens, formatUsd } from "./format";
import { Source } from "./Source";
import { ANTHROPIC_PRICES, OPENAI_PRICES } from "@/lib/domain/pricing";

type Src = "M" | "R" | "D";

interface Metric {
  label: string;
  src: Src;
  hint: string;
  pick: (r: RunTurnResult) => number | null;
  format: (n: number) => string;
}

interface AgentValues {
  competitor: Competitor;
  name: string;
  full: string;
  expected: number;
  results: RunTurnResult[];
}

const KEY_METRICS: Metric[] = [
  {
    label: "Time",
    src: "M",
    hint: "Measured by Dyon around the agent call, excluding the check and the diff.",
    pick: (r) => r.wallMs,
    format: formatMs,
  },
  {
    label: "Cost",
    src: "D",
    hint: `Reported tokens × published list prices, same method for every agent (lib/domain/pricing.ts; Anthropic prices read ${ANTHROPIC_PRICES.readOn}, OpenAI prices read ${OPENAI_PRICES.readOn}). Codex web actions are not priced: billing per action is not reported.`,
    pick: (r) => r.cost.computedUsd,
    format: formatUsd,
  },
  {
    label: "Output tokens",
    src: "D",
    hint: "This turn's share of the agent's running total, including reasoning.",
    pick: (r) => r.tokens?.output ?? null,
    format: formatTokens,
  },
  {
    label: "Files changed",
    src: "M",
    hint: "git diff against the workspace at the start of the turn.",
    pick: (r) => (r.diff ? r.diff.files.length : null),
    format: String,
  },
];

const MORE_METRICS: Metric[] = [
  {
    label: "Input tokens",
    src: "D",
    hint: "Including cached reads and cache writes.",
    pick: (r) => r.tokens?.input ?? null,
    format: formatTokens,
  },
  {
    label: "Cached reads",
    src: "D",
    hint: "Input tokens served from the prompt cache.",
    pick: (r) => r.tokens?.cacheRead ?? null,
    format: formatTokens,
  },
  {
    label: "Cache writes",
    src: "D",
    hint: "Input tokens written to the prompt cache.",
    pick: (r) => r.tokens?.cacheWrite ?? null,
    format: formatTokens,
  },
  {
    label: "Reasoning tokens",
    src: "D",
    hint: "Part of output tokens.",
    pick: (r) => r.tokens?.reasoning ?? null,
    format: formatTokens,
  },
  {
    label: "Agent's own cost figure",
    src: "R",
    hint: "Claude Code reports total_cost_usd (same list-price method); Codex reports none.",
    pick: (r) => r.cost.reportedUsd,
    format: formatUsd,
  },
  {
    label: "Web actions not priced",
    src: "R",
    hint: "Codex web actions whose billing is not reported.",
    pick: (r) => r.cost.unpricedWebActions ?? 0,
    format: String,
  },
  {
    label: "Commands",
    src: "R",
    hint: "Shell commands the agent ran.",
    pick: (r) => r.counts.commands,
    format: String,
  },
  {
    label: "File reads",
    src: "R",
    hint: "Read tools. Codex reads files with shell commands, counted as commands.",
    pick: (r) => r.counts.fileReads,
    format: String,
  },
  {
    label: "File edits",
    src: "R",
    hint: "Write, edit or patch actions. Codex often writes files with shell commands, counted as commands.",
    pick: (r) => r.counts.fileEdits,
    format: String,
  },
  {
    label: "Web searches and fetches",
    src: "R",
    hint: "Web actions the agent reported.",
    pick: (r) => r.counts.webSearches,
    format: String,
  },
  {
    label: "Other tool calls",
    src: "R",
    hint: "Planning, sub-agents, tool loading and other tools.",
    pick: (r) => r.counts.otherTools,
    format: String,
  },
  {
    label: "Failed actions",
    src: "R",
    hint: "Actions the agent marked as failed (Codex counts non-zero exits).",
    pick: (r) => r.counts.failedActions,
    format: String,
  },
  {
    label: "Lines added",
    src: "M",
    hint: "git diff --numstat.",
    pick: (r) => (r.diff ? r.diff.files.reduce((a, f) => a + (f.added ?? 0), 0) : null),
    format: String,
  },
  {
    label: "Lines removed",
    src: "M",
    hint: "git diff --numstat.",
    pick: (r) => (r.diff ? r.diff.files.reduce((a, f) => a + (f.removed ?? 0), 0) : null),
    format: String,
  },
];

function valuesOf(a: AgentValues, metric: Metric): number[] {
  return a.results.map(metric.pick).filter((v): v is number => v !== null && v !== undefined);
}

/** Median, range and display text of one agent on one metric. */
function stat(a: AgentValues, metric: Metric) {
  const values = valuesOf(a, metric);
  if (values.length === 0)
    return { values, mid: null, lo: null, hi: null, text: a.results.length ? "not reported" : "–" };
  const mid = median(values)!;
  const [lo, hi] = range(values)!;
  const text = values.length > 1 ? `${metric.format(mid)}` : metric.format(mid);
  return { values, mid, lo, hi, text };
}

/** One metric as a small bar chart: a track per agent, filled up to the value on a shared scale. */
function Gauge({ metric, agents }: { metric: Metric; agents: AgentValues[] }) {
  const competitorLabel = (c: Competitor) => agents.find((a) => a.competitor.id === c.id)!.full;
  const stats = agents.map((a) => ({ competitor: a.competitor, ...stat(a, metric) }));
  const max = Math.max(0, ...stats.map((s) => s.hi ?? 0));
  return (
    <div className="gauge">
      <div className="gauge-label">
        {metric.label}
        <Source kind={metric.src} detail={metric.hint} />
      </div>
      {stats.map((s) => {
        const pct = (v: number) => (max > 0 ? (v / max) * 100 : 0);
        const tip =
          s.mid === null
            ? `${competitorLabel(s.competitor)}: ${s.text}`
            : s.values.length > 1
              ? `${competitorLabel(s.competitor)}: median ${metric.format(s.mid)}, from ${metric.format(s.lo!)} to ${metric.format(s.hi!)} over ${s.values.length} runs`
              : `${competitorLabel(s.competitor)}: ${metric.format(s.mid)}`;
        return (
          <div key={s.competitor.id} className={`gauge-row ${slotClass(s.competitor)}`} title={tip}>
            <span className="dot" aria-label={competitorLabel(s.competitor)} />
            <span className="gauge-track">
              {s.mid !== null && (
                <span className="gauge-fill" style={{ width: `${Math.max(pct(s.mid), s.mid > 0 ? 1.5 : 0)}%` }} />
              )}
              {s.values.length > 1 && s.lo !== null && s.hi !== null && (
                <span
                  className="gauge-range"
                  style={{ left: `${pct(s.lo)}%`, width: `${Math.max(pct(s.hi) - pct(s.lo), 0.5)}%` }}
                />
              )}
            </span>
            <span className={`gauge-value ${s.mid === null ? "muted" : ""}`}>{s.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function Outcome({ a, check }: { a: AgentValues; check: string | null }) {
  if (a.results.length === 0) return <span className="muted">Running</span>;
  if (check) {
    const checked = a.results.filter((r) => r.check);
    const passed = checked.filter((r) => r.check?.passed).length;
    const all = passed === checked.length;
    const [lo, hi] = wilson(passed, checked.length);
    return (
      <span className="outcome-text">
        {all ? (
          <CircleCheck size={14} className="ok" />
        ) : passed === 0 ? (
          <CircleX size={14} className="bad" />
        ) : (
          <TriangleAlert size={14} className="warn" />
        )}
        {checked.length === 1 ? (all ? "Check passed" : "Check failed") : `${passed} of ${checked.length} passed`}
        {checked.length > 1 && (
          <span className="muted">
            {" "}
            · 95% range {formatPct(lo)} to {formatPct(hi)}
          </span>
        )}
      </span>
    );
  }
  const completed = a.results.filter((r) => r.outcome.status === "completed").length;
  return (
    <span className="outcome-text">
      {completed === a.results.length ? (
        <CircleCheck size={14} className="ok" />
      ) : (
        <CircleX size={14} className="bad" />
      )}
      {a.results.length === 1
        ? completed
          ? "Completed"
          : "Did not complete"
        : `${completed} of ${a.results.length} completed`}
    </span>
  );
}

export function CompareTable({
  comparison,
  turn,
  printable = false,
}: {
  comparison: ComparisonInfo;
  turn: Pick<TurnView, "results">;
  printable?: boolean;
}) {
  const [more, setMore] = useState(printable);
  const naming = useNaming(comparison);
  const agents: AgentValues[] = comparison.competitors.map((competitor) => {
    const runs = runsOf(comparison, competitor);
    return {
      competitor,
      name: naming.name(competitor),
      full: naming.full(competitor),
      expected: runs.length,
      results: runs.flatMap((r) => (turn.results[r.runId] ? [turn.results[r.runId]] : [])),
    };
  });
  const pending = agents.some((a) => a.results.length < a.expected);
  const note: ReactNode =
    comparison.repeats === 1
      ? "One run per agent: an observation, not a verdict."
      : `${comparison.repeats} runs per agent: bars show the median, the thin line the range.`;

  return (
    <div className="compare">
      <div className="compare-outcomes">
        {agents.map((a) => (
          <div key={a.competitor.id} className={`outcome ${slotClass(a.competitor)}`} title={a.full}>
            <span className="dot" />
            <span className="outcome-agent">{a.name}</span>
            <Outcome a={a} check={comparison.check} />
          </div>
        ))}
      </div>
      <div className="gauges">
        {KEY_METRICS.map((metric) => (
          <Gauge key={metric.label} metric={metric} agents={agents} />
        ))}
      </div>
      {more && (
        <table className="more-metrics">
          <thead>
            <tr>
              <th>Metric</th>
              {agents.map((a) => (
                <th key={a.competitor.id} className={slotClass(a.competitor)}>
                  <span className="dot" /> {a.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...KEY_METRICS, ...MORE_METRICS].map((metric) => (
              <tr key={metric.label}>
                <th title={metric.hint}>
                  {metric.label}
                  <Source kind={metric.src} detail={metric.hint} />
                </th>
                {agents.map((a) => {
                  const s = stat(a, metric);
                  return (
                    <td key={a.competitor.id} className={s.mid === null ? "muted" : ""}>
                      {s.text}
                      {s.values.length > 1 && s.lo !== null && (
                        <span className="muted">
                          {" "}
                          ({metric.format(s.lo)} to {metric.format(s.hi!)})
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="compare-foot">
        <span className="muted small">
          {note}
          {pending && " Some runs are still going."}
        </span>
        <span className="spacer" />
        {!printable && (
          <button className="text-button" onClick={() => setMore((v) => !v)}>
            {more ? "Hide the table" : `All ${KEY_METRICS.length + MORE_METRICS.length} metrics as a table`}{" "}
            <ChevronDown size={14} className={more ? "flip" : ""} />
          </button>
        )}
      </div>
    </div>
  );
}
