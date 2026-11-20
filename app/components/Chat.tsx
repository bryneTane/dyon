"use client";

import { useState } from "react";
import type { ComparisonInfo, StreamEvent, TimelineItem } from "@/lib/domain/types";
import { TurnBlock, type RunEnd } from "./TurnBlock";

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

/** A prompt box and one column per run, listing each agent's steps as they arrive. */
export function Chat() {
  const [prompt, setPrompt] = useState("");
  const [info, setInfo] = useState<ComparisonInfo | null>(null);
  const [runs, setRuns] = useState<Record<string, TimelineItem[]>>({});
  const [ends, setEnds] = useState<Record<string, RunEnd>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(event: StreamEvent) {
    if (event.type === "comparison") {
      setInfo(event.info);
    } else if (event.type === "run_end") {
      setEnds((all) => ({ ...all, [event.runId]: { outcome: event.outcome, wallMs: event.wallMs } }));
    } else if (event.type === "item") {
      setRuns((all) => {
        const list = all[event.runId] ?? [];
        const at = list.findIndex((i) => i.id === event.item.id);
        const next = at === -1 ? [...list, event.item] : list.map((i, n) => (n === at ? event.item : i));
        return { ...all, [event.runId]: next };
      });
    } else if (event.type === "fatal") {
      setError(event.message);
    }
  }

  async function send() {
    setInfo(null);
    setRuns({});
    setEnds({});
    setError(null);
    setRunning(true);
    try {
      const response = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!response.ok || !response.body) {
        setError(
          ((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${response.status}`,
        );
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) apply(JSON.parse(line) as StreamEvent);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="chat">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim() && !running) void send();
        }}
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Describe a coding task"
        />
        <button type="submit" disabled={running || !prompt.trim()}>
          {running ? "Running…" : "Send"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {!info && !running && (
        <div className="examples">
          <p className="muted small">Or start from an example:</p>
          {EXAMPLES.map((example) => (
            <button key={example.title} type="button" onClick={() => setPrompt(example.prompt)}>
              <strong>{example.title}</strong>
              <span>{example.summary}</span>
            </button>
          ))}
        </div>
      )}
      {info && <TurnBlock info={info} items={runs} ends={ends} />}
    </div>
  );
}
