"use client";

import { CircleCheck, CircleX, LoaderCircle, TriangleAlert } from "lucide-react";
import type { RunTurnResult } from "@/lib/domain/types";

/** Outcome of one run in words and an icon: working, stopped, error, check passed or failed, completed. */
export function RunStatus({ result, live }: { result?: RunTurnResult; live: boolean }) {
  if (live || !result) {
    return (
      <span className="status-line">
        <LoaderCircle size={14} className="spin accent" /> Working
      </span>
    );
  }
  if (result.outcome.status === "aborted") {
    return (
      <span className="status-line warn">
        <TriangleAlert size={14} /> Stopped
      </span>
    );
  }
  if (result.outcome.status === "error") {
    return (
      <span className="status-line bad" title={result.outcome.detail}>
        <CircleX size={14} /> Error
      </span>
    );
  }
  if (result.check) {
    return result.check.passed ? (
      <span className="status-line ok">
        <CircleCheck size={14} /> Check passed
      </span>
    ) : (
      <span className="status-line bad">
        <CircleX size={14} /> Check failed
      </span>
    );
  }
  return (
    <span className="status-line ok">
      <CircleCheck size={14} /> Completed
    </span>
  );
}
