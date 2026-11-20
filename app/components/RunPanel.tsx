"use client";

import { useState } from "react";
import type { RunTurnResult, TimelineItem } from "@/lib/domain/types";
import { PatchView } from "./PatchView";
import { Timeline } from "./Timeline";

/** One run's body: its steps, or the files it changed during the turn. */
export function RunPanel({ items, result }: { items: TimelineItem[]; result?: RunTurnResult }) {
  const [tab, setTab] = useState<"steps" | "changes">("steps");
  const diff = result?.diff;
  return (
    <>
      <nav className="tabs">
        <button className={tab === "steps" ? "on" : ""} onClick={() => setTab("steps")}>
          Steps <span className="count">{items.length}</span>
        </button>
        <button className={tab === "changes" ? "on" : ""} onClick={() => setTab("changes")} disabled={!diff}>
          Changes {diff && <span className="count">{diff.files.length}</span>}
        </button>
      </nav>
      {tab === "steps" || !diff ? <Timeline items={items} /> : <Changes diff={diff} />}
    </>
  );
}

function Changes({ diff }: { diff: NonNullable<RunTurnResult["diff"]> }) {
  if (diff.files.length === 0) return <p className="muted small">No file changed during this turn.</p>;
  return (
    <div className="changes">
      <ul className="changed-files">
        {diff.files.map((f) => (
          <li key={f.path}>
            <span className={`change ${f.change}`}>{f.change}</span> <code>{f.path}</code>{" "}
            <span className="muted">{f.added === null ? "binary" : `+${f.added} −${f.removed}`}</span>
          </li>
        ))}
      </ul>
      <PatchView patch={diff.patch} />
      {diff.truncated && <p className="muted small">The patch is longer than 200,000 characters and was cut.</p>}
    </div>
  );
}
