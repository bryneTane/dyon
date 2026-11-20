"use client";

import { useState } from "react";
import type { ComparisonInfo, StreamEvent, TimelineItem } from "@/lib/domain/types";
import { TurnBlock, type RunEnd } from "./TurnBlock";

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
      {info && <TurnBlock info={info} items={runs} ends={ends} />}
    </div>
  );
}
