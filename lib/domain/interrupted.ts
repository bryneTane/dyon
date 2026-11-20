import type { ComparisonRecord } from "./types";

export const INTERRUPTED =
  "This turn was interrupted because the server stopped. Runs that had not finished were cut short, with the files they had changed so far. A follow-up is accepted.";

/**
 * A turn that is not done and was not started by this server process (`bootId`) can never finish: the process
 * that ran it is gone. Returns the record with that turn closed and the comparison free again, or null when
 * nothing needs closing. Pure: the caller saves the result inside a transaction.
 */
export function closeInterruptedTurn(record: ComparisonRecord, bootId: string): ComparisonRecord | null {
  const open = record.turns.filter((t) => t.state !== "done");
  if (record.status !== "busy" && open.length === 0) return null;
  if (open.some((t) => t.bootId === bootId)) return null;
  return {
    ...record,
    status: "idle",
    stopRequested: false,
    turns: record.turns.map((t) => (t.state === "done" ? t : { ...t, state: "done", error: INTERRUPTED })),
  };
}

/** Names stay hidden while a blind comparison has no verdict. */
export function namesHidden(record: ComparisonRecord): boolean {
  return record.info.blind && record.verdict === null;
}
