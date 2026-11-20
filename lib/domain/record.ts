import type { ComparisonInfo, ComparisonRecord, LiveEvent, StreamEvent, TurnRecord } from "./types";

/** A new comparison with its first turn queued. */
export function newRecord(info: ComparisonInfo, prompt: string, now: string): ComparisonRecord {
  return {
    info,
    createdAt: now,
    status: "busy",
    stopRequested: false,
    seq: 0,
    meta: {},
    runs: Object.fromEntries(info.runs.map((run) => [run.runId, { session: null, cumulative: null, model: null }])),
    turns: [newTurn(0, prompt, now)],
    verdict: null,
  };
}

export function newTurn(index: number, prompt: string, now: string): TurnRecord {
  return { index, prompt, state: "queued", startedAt: now, bootId: null, items: {}, results: {} };
}

/**
 * The record after one event. The server keeps its saved record with it, and the page follows a comparison
 * with it, so both always show the same state. Pure: returns a new record.
 */
export function applyEvent(record: ComparisonRecord, event: StreamEvent): ComparisonRecord {
  const turn = (index: number, change: (t: TurnRecord) => TurnRecord): ComparisonRecord => ({
    ...record,
    turns: record.turns.map((t) => (t.index === index ? change(t) : t)),
  });
  switch (event.type) {
    case "comparison":
      return { ...record, info: event.info };
    case "turn_start":
      return { ...turn(event.turnIndex, (t) => ({ ...t, state: "running" })), status: "busy" };
    case "run_meta":
      return { ...record, meta: { ...record.meta, [event.runId]: { model: event.model, version: event.version } } };
    case "item":
      return turn(event.turnIndex, (t) => {
        const list = t.items[event.runId] ?? [];
        const at = list.findIndex((i) => i.id === event.item.id);
        const next = at === -1 ? [...list, event.item] : list.map((i, n) => (n === at ? event.item : i));
        return { ...t, items: { ...t.items, [event.runId]: next } };
      });
    case "run_done":
      return turn(event.turnIndex, (t) => ({ ...t, results: { ...t.results, [event.runId]: event.result } }));
    case "turn_done":
      return { ...turn(event.turnIndex, (t) => ({ ...t, state: "done" })), status: "idle" };
    case "fatal": {
      const last = record.turns.at(-1);
      return last ? turn(last.index, (t) => ({ ...t, error: event.message })) : record;
    }
  }
}

/**
 * What a follower does with a numbered event: apply the next one, ignore one already applied, and reload the
 * saved record when some were missed.
 */
export function followEvent(record: ComparisonRecord, live: LiveEvent): { record: ComparisonRecord; gap: boolean } {
  if (live.seq <= record.seq) return { record, gap: false };
  if (live.seq > record.seq + 1) return { record, gap: true };
  return { record: { ...applyEvent(record, live.event), seq: live.seq }, gap: false };
}
