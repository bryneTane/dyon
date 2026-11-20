import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CircleCheck, CircleX, EyeOff, TriangleAlert } from "lucide-react";
import { competitorLabel, settingsLabel, VENDOR_LABELS } from "@/lib/domain/catalog";
import { ANTHROPIC_PRICES, OPENAI_PRICES } from "@/lib/domain/pricing";
import { namesHidden } from "@/lib/domain/interrupted";
import type { Catalog } from "@/lib/domain/catalog";
import { loadCatalog } from "@/lib/server/catalog";
import { loadRecord } from "@/lib/server/turns";
import type { Competitor, ComparisonRecord, RunTurnResult, TimelineItem } from "@/lib/domain/types";
import { CompareTable } from "@/app/components/CompareTable";
import { Markdown } from "@/app/components/Markdown";
import { ReportActions } from "@/app/components/ReportActions";
import { CatalogProvider, HideNames } from "@/app/components/naming";
import { formatMs, formatUsd } from "@/app/components/format";

export const dynamic = "force-dynamic";

const OTHER: Record<string, string> = { tie: "A tie", all_bad: "None of them did good work" };

/** First sentence of the prompt's first line, cut at a word boundary when too long. */
function clipTitle(text: string, max = 120) {
  const flat = (text.trim().split("\n")[0] ?? "").replace(/\s+/g, " ").replace(/:$/, "");
  const sentence = flat.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? flat;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : max)}…`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const record = loadRecord((await params).id);
  if (!record) return { title: "Report not found · Dyon" };
  const catalog = await loadCatalog();
  const title = clipTitle(record.turns[0]?.prompt ?? "Comparison", 80);
  const who = namesHidden(record)
    ? `${record.info.competitors.length} coding agents`
    : record.info.competitors.map((c) => competitorLabel(c, catalog)).join(" vs ");
  return {
    title: `${title} · Dyon report`,
    description: `${who}, same task, measured side by side.`,
    openGraph: { title, description: `${who}, same task, measured side by side.`, type: "article" },
    twitter: { card: "summary_large_image", title },
  };
}

function lastMessage(items: TimelineItem[] | undefined): string | null {
  const message = [...(items ?? [])].reverse().find((i) => i.kind === "message");
  return message && message.kind === "message" ? message.text : null;
}

function Outcome({ result }: { result: RunTurnResult | undefined }) {
  if (!result) return <span className="muted">No result</span>;
  if (result.outcome.status !== "completed")
    return (
      <span className="bad">
        <CircleX size={14} /> {result.outcome.status === "aborted" ? "Stopped" : "Error"}
      </span>
    );
  if (result.check)
    return result.check.passed ? (
      <span className="ok">
        <CircleCheck size={14} /> Check passed
      </span>
    ) : (
      <span className="bad">
        <CircleX size={14} /> Check failed
      </span>
    );
  return (
    <span className="ok">
      <CircleCheck size={14} /> Completed
    </span>
  );
}

function CompetitorSection({
  record,
  competitor,
  hidden,
  catalog,
}: {
  record: ComparisonRecord;
  competitor: Competitor;
  hidden: boolean;
  catalog: Catalog;
}) {
  const run = record.info.runs.find((r) => r.competitorId === competitor.id)!;
  const last = record.turns.at(-1);
  const result = last?.results[run.runId];
  const message = lastMessage(last?.items[run.runId]);
  const meta = record.meta[run.runId];
  const name = hidden ? `Competitor ${competitor.id.toUpperCase()}` : VENDOR_LABELS[competitor.vendor];
  return (
    <section className={`report-competitor slot-${competitor.slot}`}>
      <header>
        <span className="dot" />
        <strong>{name}</strong>
        {!hidden && <span className="muted">{settingsLabel(competitor, catalog)}</span>}
        <span className="spacer" />
        <Outcome result={result} />
      </header>
      {record.info.repeats > 1 && <p className="muted small">Showing run 1 of {record.info.repeats}.</p>}
      {message && (
        <div className="report-message">
          <div className="report-label">Final message</div>
          <Markdown text={message} />
        </div>
      )}
      {result?.diff && (
        <div>
          <div className="report-label">Files changed ({result.diff!.files.length})</div>
          {result.diff!.files.length === 0 ? (
            <p className="muted small">No changes.</p>
          ) : (
            <ul className="report-files">
              {result.diff!.files.map((f) => (
                <li key={f.path}>
                  <code>{f.path}</code>
                  <span className="ok">{f.added !== null ? `+${f.added}` : "binary"}</span>
                  <span className="bad">{f.removed ? `−${f.removed}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!hidden && meta?.model && (
        <p className="muted small">
          Model reported by the agent: <code>{meta.model}</code>
          {meta.version ? `, CLI ${meta.version}` : ""}.
        </p>
      )}
    </section>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const record = loadRecord((await params).id);
  if (!record) notFound();
  const catalog = await loadCatalog();
  const { info, verdict } = record;
  const hidden = namesHidden(record);
  const task = record.turns[0];
  const winner = verdict && info.competitors.find((c) => c.id === verdict.winner);
  const totals = info.competitors.map((c) => {
    const runIds = info.runs.filter((r) => r.competitorId === c.id).map((r) => r.runId);
    const results = record.turns.flatMap((t) => runIds.map((id) => t.results[id]).filter(Boolean));
    const cost = results.every((r) => r.cost.computedUsd !== null)
      ? results.reduce((a, r) => a + (r.cost.computedUsd ?? 0), 0)
      : null;
    return { c, wallMs: results.reduce((a, r) => a + r.wallMs, 0), cost };
  });

  return (
    <CatalogProvider value={catalog}>
      <HideNames hidden={hidden}>
        <div className="report-page">
          <header className="report-top">
            <a className="wordmark" href="/">
              Dyon
            </a>
            <span className="muted small">Comparison report</span>
            <span className="spacer" />
            <ReportActions title={clipTitle(task?.prompt ?? "", 80)} />
          </header>

          <main className="report">
            <p className="report-kicker">
              {new Date(record.createdAt).toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" })}{" "}
              · {info.competitors.length} agents · {info.repeats === 1 ? "one run each" : `${info.repeats} runs each`}
            </p>
            <h1>{clipTitle(task?.prompt ?? "Untitled task")}</h1>
            {task && clipTitle(task.prompt) !== task.prompt.trim() && (
              <blockquote className="report-prompt">{task.prompt}</blockquote>
            )}
            <ul className="report-setup">
              <li>Started from an empty workspace.</li>
              {info.check ? (
                <li>
                  Check, run after each turn and never shown to the agents: <code>{info.check}</code>
                </li>
              ) : (
                <li>No automatic check.</li>
              )}
            </ul>

            <section className="report-verdict">
              {verdict ? (
                <>
                  <div className="report-label">
                    Verdict{" "}
                    {verdict.blind && (
                      <span className="badge">
                        <EyeOff size={12} /> judged blind
                      </span>
                    )}
                  </div>
                  <div className={`report-winner ${winner ? `slot-${winner.slot}` : ""}`}>
                    {winner ? (
                      <>
                        <span className="dot" /> {competitorLabel(winner, catalog)} did the better work
                      </>
                    ) : (
                      OTHER[verdict.winner]
                    )}
                  </div>
                  {verdict.note && <p className="report-note">{verdict.note}</p>}
                </>
              ) : (
                <>
                  <div className="report-label">Verdict</div>
                  <p className="muted">
                    <TriangleAlert size={14} className="warn" /> No verdict recorded yet. The numbers below say who was
                    faster and cheaper, not whose work is better.
                  </p>
                </>
              )}
            </section>

            <section className="report-totals">
              {totals.map(({ c, wallMs, cost }) => (
                <div key={c.id} className={`report-total slot-${c.slot}`}>
                  <div className="report-total-name">
                    <span className="dot" /> {hidden ? `Competitor ${c.id.toUpperCase()}` : competitorLabel(c, catalog)}
                  </div>
                  <div className="report-total-figures">
                    <span>
                      <span className="figure">{formatMs(wallMs)}</span>
                      <span className="figure-label">total time</span>
                    </span>
                    <span>
                      <span className="figure">{cost !== null ? formatUsd(cost) : "–"}</span>
                      <span className="figure-label">total cost</span>
                    </span>
                  </div>
                </div>
              ))}
            </section>

            {record.turns.map((turn) => (
              <section key={turn.index} className="report-turn">
                <h2>{turn.index === 0 ? "The task" : `Follow-up ${turn.index}`}</h2>
                {turn.index > 0 && <blockquote className="report-prompt">{turn.prompt}</blockquote>}
                {Object.keys(turn.results).length > 0 ? (
                  <CompareTable comparison={info} turn={turn} printable />
                ) : (
                  <p className="muted">This turn has no results.</p>
                )}
              </section>
            ))}

            <h2>What each agent delivered</h2>
            <div className="report-competitors">
              {info.competitors.map((c) => (
                <CompetitorSection key={c.id} record={record} competitor={c} hidden={hidden} catalog={catalog} />
              ))}
            </div>

            <section className="report-method">
              <h2>Method</h2>
              <ul>
                <li>
                  Each agent ran in its own fresh workspace, in parallel, through its official SDK, with no approval
                  prompts and none of the machine&apos;s own settings.
                </li>
                <li>
                  <strong>M</strong> measured by Dyon (time, files changed, check), <strong>R</strong> reported by the
                  agent (tokens, actions), <strong>D</strong> derived by Dyon from reported values (cost).
                </li>
                <li>
                  Cost is reported tokens × published list prices, the same method for every agent (Anthropic prices
                  read on {ANTHROPIC_PRICES.readOn}, OpenAI prices read on {OPENAI_PRICES.readOn}). For Claude Code it
                  matches the agent&apos;s own figure; Codex reports none.
                </li>
                <li>
                  {info.repeats === 1
                    ? "One run per agent is an observation, not a verdict: agents vary from run to run."
                    : `${info.repeats} runs per agent: charts show the median and the range.`}
                </li>
              </ul>
            </section>
          </main>
          <footer className="report-foot muted small">Generated by Dyon, a coding agent comparator.</footer>
        </div>
      </HideNames>
    </CatalogProvider>
  );
}
