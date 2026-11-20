"use client";

import { useState } from "react";
import type { StreamEvent, TimelineItem } from "@/lib/domain/types";

/** A prompt box and one column listing the agent's steps as they arrive. */
export function Chat() {
  const [prompt, setPrompt] = useState("");
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(event: StreamEvent) {
    if (event.type === "item") {
      setItems((list) => {
        const at = list.findIndex((i) => i.id === event.item.id);
        return at === -1 ? [...list, event.item] : list.map((i, n) => (n === at ? event.item : i));
      });
    } else if (event.type === "fatal") {
      setError(event.message);
    }
  }

  async function send() {
    setItems([]);
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
      <ol className="steps">
        {items.map((item) => (
          <li key={item.id}>
            <code>
              {item.kind}
              {item.status ? ` (${item.status})` : ""}
            </code>{" "}
            {describe(item)}
          </li>
        ))}
      </ol>
    </div>
  );
}

function describe(item: TimelineItem): string {
  switch (item.kind) {
    case "message":
    case "reasoning":
      return item.text;
    case "command":
      return item.output ? `${item.command}\n${item.output}` : item.command;
    case "file_read":
      return item.target;
    case "file_edit":
      return item.files.map((f) => f.path).join(", ");
    case "web_search":
      return item.query;
    case "web_fetch":
      return item.url;
    case "tool":
      return `${item.name} ${item.input}`;
    case "error":
      return item.text;
    case "notice":
      return `${item.label}: ${item.text}`;
    case "event":
      return `${item.name} ${item.detail}`;
    case "check":
      return item.command;
  }
}
