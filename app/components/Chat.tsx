"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Plus } from "lucide-react";
import { CompetitorPicker } from "./CompetitorPicker";
import {
  defaultCompetitors,
  isValidSpec,
  VENDOR_LABELS,
  VENDORS,
  type Catalog,
  type CompetitorSpec,
} from "@/lib/domain/catalog";
import { CatalogProvider } from "./naming";
import { turnView, useComparison } from "./useComparison";
import { TurnBlock, type InspectTarget } from "./TurnBlock";
import { Inspector } from "./Inspector";

/**
 * Tasks offered on the empty screen, one per kind of task public comparisons of coding agents use:
 * building a small app or game, implementing an algorithm to a precise spec, and fixing bugs in existing code.
 */
const EXAMPLES = [
  {
    title: "A mini game",
    summary: "A Snake game in one HTML file.",
    prompt:
      "Create a tiny Snake game in a single index.html file, with no dependencies and no external files. Arrow keys move the snake, eating food grows it by one and adds a point, hitting a wall or itself ends the game, and Space restarts. Show the score.",
  },
  {
    title: "An algorithm",
    summary: "Earliest arrival through a train timetable, with transfers.",
    prompt:
      'Create journey.js, a Node.js module with no dependencies, exporting earliestArrival(connections, from, to, departAt).\n\nconnections is an array of { trip, from, to, dep, arr }: a train of trip trip leaves station from at dep and reaches station to at arr. Times are "HH:MM" strings within one day, and dep < arr.\n\nA traveller is at station from at time departAt. They may board a connection that leaves their current station at or after the time they are there. Staying on the same trip needs no time; changing to another trip needs at least 5 minutes at the station (the first boarding needs none).\n\nReturn { arrival, trips }: the earliest possible arrival time at station to, as "HH:MM", and the number of distinct trips used. When several journeys reach to at that earliest time, return the smallest number of trips. Return null when to cannot be reached. When from equals to, return { arrival: departAt, trips: 0 }.\n\nIt must stay fast: 50,000 connections must be handled in well under a second.',
  },
  {
    title: "Fix a bug",
    summary: "Find and fix the bugs in a shopping cart total.",
    prompt:
      'Create cart.js with exactly this code:\n\n```js\nexport function cartTotal(items, coupon) {\n  items.sort((a, b) => b.price - a.price);\n  let subtotal = 0;\n  for (const item of items) {\n    let line = item.price * item.qty;\n    if (item.qty > 10) line = line * 0.95;\n    subtotal += line;\n  }\n  const shipping = subtotal >= 5000 ? 0 : 499;\n  if (coupon === "SAVE10") subtotal = subtotal * 0.9;\n  if (coupon === "FREESHIP") return Math.round(subtotal);\n  return Math.round(subtotal + shipping);\n}\n```\n\nCustomers report wrong totals. Fix the bugs so that cartTotal follows these rules, keeping the same export and signature:\n\n- items is an array of { price, qty }: price in integer cents, qty an integer of at least 1. The result is the total in integer cents.\n- A line of 10 or more units gets 5% off that line, rounded to the nearest cent, halves rounded up.\n- The coupon SAVE10 takes 10% off the sum of the lines, rounded to the nearest cent, halves rounded up.\n- Shipping costs 499 cents, and is free when the sum after all discounts is at least 5000 cents. The coupon FREESHIP makes shipping free.\n- Coupon codes are case-insensitive. No coupon is null or undefined. Any other coupon throws an Error with the message "unknown coupon".\n- cartTotal must not modify its arguments.',
  },
];

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
  const { record, error, setError, open, reset } = useComparison();
  const textareaRef = useAutoHeight(prompt);
  const endRef = useRef<HTMLDivElement>(null);
  const running = sending || record?.status === "busy";
  const started = Boolean(record);
  const comparison = record?.info ?? null;
  const turns = record?.turns.map(turnView) ?? [];

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

  /** A follow-up: every agent continues its own session, in its own workspace. */
  async function followUp() {
    if (!record) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/comparisons/${record.info.id}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
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
        body: JSON.stringify({ prompt: prompt.trim(), competitors: chosen }),
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
      <div className="composer-bar">
        {started && comparison ? (
          <span className="bar-summary">
            Goes to all {comparison.runs.length} runs; each keeps its session and files.
          </span>
        ) : catalog ? (
          <CompetitorPicker catalog={catalog} value={competitors} onChange={setPicked} />
        ) : (
          <span className="bar-summary">Loading the agents&apos; models…</span>
        )}
        <span className="spacer" />
        {!running && !started && competitors.length > 0 && (
          <span className="hint">{`${competitors.length} run${competitors.length > 1 ? "s" : ""}`}</span>
        )}
        <button className="send" onClick={() => void submit()} disabled={!canSend} title="Send (Enter)">
          <ArrowUp size={18} />
        </button>
      </div>
    </div>
  );

  return (
    <CatalogProvider value={catalog ?? NO_CATALOG}>
      <div className="app">
        <header className="topbar">
          <span className="wordmark">Dyon</span>
          <span className="spacer" />
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
                    <button key={example.title} className="example" onClick={() => setPrompt(example.prompt)}>
                      <span className="example-title">{example.title}</span>
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
    </CatalogProvider>
  );
}
