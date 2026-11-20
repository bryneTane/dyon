"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChartColumn, EyeOff, FileText, FlaskConical, Plus, RotateCcw, Square } from "lucide-react";
import { CompetitorPicker } from "./CompetitorPicker";
import {
  defaultCompetitors,
  isValidSpec,
  VENDOR_LABELS,
  VENDORS,
  type Catalog,
  type CompetitorSpec,
} from "@/lib/domain/catalog";
import { EXAMPLES } from "./examples";
import { KeysButton, loadKeys, useKeyRequirements, type UserKeys } from "./KeysButton";
import { CatalogProvider, NamesHidden } from "./naming";
import { Scoreboard, type TaskSetup } from "./Scoreboard";
import { VerdictBox } from "./VerdictBox";
import { turnView, useComparison } from "./useComparison";
import { TurnBlock, type InspectTarget } from "./TurnBlock";
import { Inspector } from "./Inspector";

/** Textarea that grows with its content, up to a limit. */
function useAutoHeight(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);
  return ref;
}

const NO_CATALOG: Catalog = { claude: { models: [] }, codex: { models: [] } };

/** The task box, then the comparison it started, followed live and kept across refreshes. */
export function Chat() {
  const [prompt, setPrompt] = useState("");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [sending, setSending] = useState(false);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  // Null until the user changes them: then each agent's own default model.
  const [picked, setPicked] = useState<CompetitorSpec[] | null>(null);
  const [repeats, setRepeats] = useState(1);
  const [check, setCheck] = useState("");
  const [checkOpen, setCheckOpen] = useState(false);
  const [blind, setBlind] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [showScoreboard, setShowScoreboard] = useState(false);
  // The user's own API keys, kept in this tab only and sent with each turn.
  const [keys, setKeys] = useState<UserKeys>({});
  const [keysOpen, setKeysOpen] = useState(false);
  useEffect(() => setKeys(loadKeys()), []);
  const { record, error, setError, open, reset, saveVerdict } = useComparison();
  const textareaRef = useAutoHeight(prompt);
  const endRef = useRef<HTMLDivElement>(null);
  const running = sending || record?.status === "busy";
  const started = Boolean(record);
  const comparison = record?.info ?? null;
  const turns = record?.turns.map(turnView) ?? [];
  if (!running && stopping) setStopping(false);

  // After a refresh or on an opened link, show the latest turn side by side, as right after sending.
  const openedId = record?.info.id;
  const turnCount = record?.turns.length ?? 0;
  useEffect(() => {
    if (openedId && turnCount > 0) setInspect((current) => current ?? { turnIndex: turnCount - 1, runId: null });
  }, [openedId, turnCount]);

  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => r.json() as Promise<{ catalog: Catalog }>)
      .then(({ catalog }) => setCatalog(catalog))
      .catch((e) => setError(`Could not read the agents' models: ${e instanceof Error ? e.message : String(e)}`));
  }, [setError]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length]);

  const competitors = picked ?? (catalog ? defaultCompetitors(catalog) : []);
  const canSend = prompt.trim().length > 0 && !running && (started || competitors.length > 0);
  const vendors = (started ? (record?.info.competitors ?? []) : competitors).map((c) => c.vendor);
  const requiredKeys = useKeyRequirements(vendors);
  /** True when keys are missing: the keys box opens instead of sending. */
  function keysMissing(): boolean {
    const missing = requiredKeys.some((v) => !keys[v === "claude" ? "anthropic" : "openai"]);
    if (missing) setKeysOpen(true);
    return missing;
  }

  /** A follow-up: every agent continues its own session, in its own workspace. */
  async function followUp() {
    if (!record || keysMissing()) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/comparisons/${record.info.id}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), keys }),
      });
      const body = (await response.json().catch(() => null)) as { turnIndex?: number; error?: string } | null;
      if (!response.ok || body?.turnIndex === undefined) return setError(body?.error ?? `HTTP ${response.status}`);
      setPrompt("");
      setInspect({ turnIndex: body.turnIndex, runId: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  async function submit() {
    if (!canSend) return;
    if (started) return followUp();
    if (keysMissing()) return;
    setSending(true);
    setError(null);
    try {
      // Read again: the agents' catalog is cached by the server once it loads fully, and retried until then.
      const { catalog } = (await (await fetch("/api/catalog")).json()) as { catalog: Catalog };
      setCatalog(catalog);
      const missing = VENDORS.flatMap((v) => (catalog[v].error ? [`${VENDOR_LABELS[v]}: ${catalog[v].error}`] : []));
      if (missing.length) return setError(`${missing.join(" ")} Try again in a moment.`);
      const chosen = picked?.filter((c) => isValidSpec(c, catalog)) ?? defaultCompetitors(catalog);
      const response = await fetch("/api/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          competitors: chosen,
          repeats,
          check: checkOpen ? check : null,
          blind,
          keys,
        }),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !body?.id) return setError(body?.error ?? `HTTP ${response.status}`);
      setPrompt("");
      // Open the live side-by-side view of the new turn.
      setInspect({ turnIndex: 0, runId: null });
      open(body.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  /** Every run of the turn ends "stopped", keeping the steps it had. */
  async function stop() {
    if (!record) return;
    setStopping(true);
    const response = await fetch(`/api/comparisons/${record.info.id}/stop`, { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setStopping(false);
      setError("Could not stop the turn. Try again.");
    }
  }

  /** Same task and check, ready to run again; competitors and options stay editable. */
  function prefill(task: TaskSetup & { blind?: boolean; competitors?: CompetitorSpec[]; repeats?: number }) {
    reset();
    setInspect(null);
    setPrompt(task.prompt);
    setCheck(task.check ?? "");
    setCheckOpen(Boolean(task.check));
    if (task.blind !== undefined) setBlind(task.blind);
    if (task.competitors) setPicked(task.competitors);
    if (task.repeats) setRepeats(task.repeats);
  }

  function runAgain() {
    if (!comparison || !record?.turns[0]) return;
    prefill({
      prompt: record.turns[0].prompt,
      check: comparison.check,
      blind: comparison.blind,
      repeats: comparison.repeats,
      competitors: comparison.competitors.map(({ vendor, model, effort }) => ({ vendor, model, effort })),
    });
  }

  const runsTotal = competitors.length * repeats;

  function newComparison() {
    reset();
    setInspect(null);
    setPrompt("");
  }

  const composer = (
    <div className="composer">
      <textarea
        ref={textareaRef}
        rows={1}
        value={prompt}
        autoFocus
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={
          !started
            ? "Describe a coding task for the agents…"
            : running
              ? "The agents are working. You can write your follow-up and send it when they finish."
              : "Send a follow-up to every agent…"
        }
      />
      {!started && checkOpen && (
        <div className="check-row">
          <FlaskConical size={14} className="muted" />
          <textarea
            className="check-input"
            rows={Math.min(6, Math.max(1, check.split("\n").length))}
            placeholder="Check command, e.g. npm test. Runs in each workspace after each turn; exit 0 = pass. The agents never see it."
            value={check}
            onChange={(e) => setCheck(e.target.value)}
          />
        </div>
      )}
      <div className="composer-bar">
        {started && comparison ? (
          <span className="bar-summary">
            Goes to all {comparison.runs.length} runs; each keeps its session and files.
          </span>
        ) : catalog ? (
          <>
            <CompetitorPicker catalog={catalog} value={competitors} onChange={setPicked} />
            <span className="bar-sep" />
            <div
              className="segmented"
              title="Runs per agent. Several runs show how much results vary; each run costs as much as one."
            >
              {[1, 3, 5].map((n) => (
                <button key={n} className={repeats === n ? "on" : ""} onClick={() => setRepeats(n)}>
                  ×{n}
                </button>
              ))}
            </div>
            <button
              className={`chip ${blind ? "on" : ""}`}
              onClick={() => setBlind((v) => !v)}
              aria-pressed={blind}
              title="Hide agent names and models until you give your verdict"
            >
              <EyeOff size={13} /> Blind
            </button>
            <button
              className={`chip ${checkOpen ? "on" : ""}`}
              onClick={() => setCheckOpen((v) => !v)}
              aria-pressed={checkOpen}
              title="A command run in each workspace after each turn, never shown to the agents"
            >
              <FlaskConical size={13} /> Check
            </button>
          </>
        ) : (
          <span className="bar-summary">Loading the agents&apos; models…</span>
        )}
        <span className="spacer" />
        <KeysButton
          keys={keys}
          onChange={(next) => {
            setKeys(next);
            setKeysOpen(false);
          }}
          required={requiredKeys}
          open={keysOpen}
        />
        {!running && !started && runsTotal > 0 && (
          <span className="hint">{`${runsTotal} run${runsTotal > 1 ? "s" : ""}`}</span>
        )}
        {started && record?.status === "busy" ? (
          <button
            className="send stop"
            onClick={() => void stop()}
            disabled={stopping}
            title={stopping ? "Stopping…" : "Stop all runs"}
          >
            {stopping ? <span className="spinner" /> : <Square size={13} fill="currentColor" />}
          </button>
        ) : (
          <button className="send" onClick={() => void submit()} disabled={!canSend} title="Send (Enter)">
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <CatalogProvider value={catalog ?? NO_CATALOG}>
      <NamesHidden value={Boolean(comparison?.blind && !record?.verdict)}>
        <div className="app">
          <header className="topbar">
            <span className="wordmark">Dyon</span>
            <span className="spacer" />
            <button className="ghost" onClick={() => setShowScoreboard(true)}>
              <ChartColumn size={15} /> Scoreboard
            </button>
            {comparison && (
              <a className="ghost" href={`/report/${comparison.id}`} target="_blank" rel="noreferrer">
                <FileText size={15} /> Report
              </a>
            )}
            {comparison && (
              <button
                className="ghost"
                onClick={runAgain}
                disabled={running}
                title="Same task and check; you can change the competitors"
              >
                <RotateCcw size={15} /> Run again
              </button>
            )}
            {started && (
              <button className="ghost" onClick={newComparison} disabled={running}>
                <Plus size={15} /> New comparison
              </button>
            )}
          </header>

          <div className={`workspace ${inspect && comparison ? "with-inspector" : ""}`}>
            <div className="chat-pane">
              {!started ? (
                <main className="welcome">
                  <h1>Compare coding agents on the same task</h1>
                  <p className="lead">
                    Claude Code and Codex work in parallel, each in a fresh workspace. Follow every step, then compare
                    time, tokens, cost and code.
                  </p>
                  {composer}
                  {error && <div className="error-box">{error}</div>}
                  <div className="examples-label">Or start from an example task</div>
                  <div className="examples">
                    {EXAMPLES.map((example) => (
                      <button
                        key={example.title}
                        className="example"
                        onClick={() => {
                          setPrompt(example.prompt);
                          setCheck(example.check ?? "");
                          setCheckOpen(Boolean(example.check));
                        }}
                      >
                        <span className="example-title">
                          {example.title}
                          {example.check && <span className="example-tag">hidden check</span>}
                        </span>
                        <span className="example-summary">{example.summary}</span>
                      </button>
                    ))}
                  </div>
                </main>
              ) : (
                <main className="thread">
                  {turns.map((turn) => (
                    <TurnBlock
                      key={turn.index}
                      comparison={comparison}
                      turn={turn}
                      meta={record!.meta}
                      inspect={inspect}
                      onInspect={setInspect}
                    />
                  ))}
                  {comparison && !running && turns.some((t) => Object.keys(t.results).length > 0) && (
                    <VerdictBox
                      key={comparison.id}
                      comparison={comparison}
                      verdict={record!.verdict}
                      onSave={saveVerdict}
                    />
                  )}
                  {error && <div className="error-box">{error}</div>}
                  <div ref={endRef} />
                </main>
              )}
              {started && <footer className="composer-dock">{composer}</footer>}
            </div>
            {inspect && comparison && turns[inspect.turnIndex] && (
              <Inspector
                comparison={comparison}
                turn={turns[inspect.turnIndex]}
                meta={record!.meta}
                target={inspect}
                onSelect={setInspect}
                onClose={() => setInspect(null)}
              />
            )}
          </div>
        </div>
        {showScoreboard && (
          <Scoreboard
            onClose={() => setShowScoreboard(false)}
            onRunAgain={(task) => {
              setShowScoreboard(false);
              prefill(task);
            }}
          />
        )}
      </NamesHidden>
    </CatalogProvider>
  );
}
