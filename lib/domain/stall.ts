import type { ComparisonRecord } from "./types";

/** The worker records a sign of life this often while it runs a turn. */
export const HEARTBEAT_MS = 5_000;
/** No sign of life for this long: the worker is gone (stopped, crashed, machine lost). */
export const STALL_MS = 60_000;
/** A queued turn that no worker started within this long. */
export const QUEUE_TIMEOUT_MS = 3 * 60_000;

export const STALLED =
  "This turn was interrupted: the worker stopped responding. A follow-up is accepted, and continues from the files as they were at the end of the last finished turn.";
export const NOT_STARTED = `No worker started this turn within ${QUEUE_TIMEOUT_MS / 60_000} minutes. A follow-up is accepted.`;

/**
 * If the comparison's current turn can no longer finish (its worker stopped sending signs of life, or no worker
 * ever started it), returns the record with that turn closed and the comparison free again; otherwise null.
 * Pure: the caller saves the result inside a transaction.
 */
export function closeStalledTurn(record: ComparisonRecord, now = Date.now()): ComparisonRecord | null {
  if (record.status !== "busy") return null;
  const turn = record.turns.at(-1);
  if (!turn || turn.state === "done") return { ...record, status: "idle", stopRequested: false };
  const since = (iso: string | undefined) => (iso ? now - Date.parse(iso) : Infinity);
  let reason: string | null = null;
  if (turn.state === "queued" && since(turn.startedAt) > QUEUE_TIMEOUT_MS) reason = NOT_STARTED;
  else if (turn.state === "running" && since(turn.heartbeatAt ?? turn.startedAt) > STALL_MS) reason = STALLED;
  if (!reason) return null;
  return {
    ...record,
    status: "idle",
    stopRequested: false,
    turns: record.turns.map((t) =>
      t.index === turn.index ? { ...t, state: "done", claim: undefined, keys: undefined, error: reason } : t,
    ),
  };
}

/** Names stay hidden while a blind comparison has no verdict. */
export function namesHidden(record: ComparisonRecord): boolean {
  return record.info.blind && record.verdict === null;
}
