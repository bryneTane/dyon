import { CheckCircle2, CircleSlash, Loader2, XCircle } from "lucide-react";
import type { RunTurnResult } from "@/lib/domain/types";
import { formatMs, formatUsd } from "./format";

/** One run's state in its column header: starting, running, or how it ended, with its time and cost. */
export function RunStatus({ result, queued }: { result?: RunTurnResult; queued: boolean }) {
  if (!result)
    return (
      <span className="status">
        <Loader2 size={14} className="spin" /> {queued ? "Starting" : "Running"}
      </span>
    );
  const summary = [
    formatMs(result.wallMs),
    result.cost.computedUsd === null ? null : formatUsd(result.cost.computedUsd),
  ]
    .filter(Boolean)
    .join(" · ");
  switch (result.outcome.status) {
    case "completed":
      return (
        <span className="status ok">
          <CheckCircle2 size={14} /> Completed · {summary}
        </span>
      );
    case "aborted":
      return (
        <span className="status">
          <CircleSlash size={14} /> Stopped · {summary}
        </span>
      );
    case "error":
      return (
        <span className="status bad" title={result.outcome.detail}>
          <XCircle size={14} /> Failed · {summary}
        </span>
      );
  }
}
