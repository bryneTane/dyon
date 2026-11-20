import "server-only";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createClaudeSession } from "@/lib/agents/claude";
import { createCodexSession } from "@/lib/agents/codex";
import type { AgentSession } from "@/lib/agents/session";
import { applyEvent } from "@/lib/domain/record";
import { errorText } from "@/lib/domain/text";
import { createStepClock } from "@/lib/domain/timing";
import type { CompetitorSpec } from "@/lib/domain/catalog";
import type { Outcome, RunState, StreamEvent, TimelineItem } from "@/lib/domain/types";
import { workDir } from "./config";
import { publish } from "./events";
import { store } from "./store";
import { createWorkspace, openWorkspace, type Workspace } from "./workspace";

/** Identifies this server process, to recognize later a turn that a restart cut short. */
export const bootId = ((globalThis as { __dyonBootId?: string }).__dyonBootId ??= randomUUID());

/** How often a running turn's record is saved, so a reload never misses more than this. */
const SAVE_EVERY_MS = 1000;

/**
 * Runs a queued turn to its end, outside any request: closing or refreshing the page does not stop it.
 * Every event is numbered, applied to the record kept in memory, and published to open tabs. The record is
 * saved at most every second, and before the turn's last event.
 */
export async function runTurn(comparisonId: string, turnIndex: number): Promise<void> {
  let record = store().get(comparisonId);
  if (!record) return;
  const turn = record.turns[turnIndex];
  let lastSave = 0;
  const save = () => {
    lastSave = Date.now();
    const current = record!;
    store().update(comparisonId, (saved) => ({ ...current, stopRequested: saved.stopRequested }));
  };
  const emit = (event: StreamEvent) => {
    const seq = record!.seq + 1;
    record = { ...applyEvent(record!, event), seq };
    // The saved record is idle before tabs learn the turn is over, so a follow-up sent at once is accepted.
    if (event.type === "turn_done" || Date.now() - lastSave >= SAVE_EVERY_MS) save();
    publish(comparisonId, { seq, event });
  };

  record = {
    ...record,
    turns: record.turns.map((t) => (t.index === turnIndex ? { ...t, bootId } : t)),
  };
  emit({ type: "turn_start", turnIndex, prompt: turn.prompt });
  const abort = new AbortController();
  await Promise.all(
    record.info.runs.map(async (run) => {
      const competitor = record!.info.competitors.find((c) => c.id === run.competitorId)!;
      const stamp = createStepClock();
      const item = (i: TimelineItem) => emit({ type: "item", runId: run.runId, turnIndex, item: stamp(i) });
      const started = Date.now();
      let outcome: Outcome;
      try {
        const root = join(workDir, comparisonId, run.runId);
        const saved = record!.runs[run.runId];
        const ws = turnIndex === 0 ? await createWorkspace(root) : await openWorkspace(root);
        const session = openSession(ws, competitor, saved?.session ?? null);
        const report = await session.send(turn.prompt, item, abort.signal);
        outcome = report.outcome;
        record = {
          ...record!,
          runs: {
            ...record!.runs,
            [run.runId]: {
              session: session.state(),
              cumulative: report.cumulative,
              model: report.model ?? saved?.model ?? null,
            },
          },
        };
        if (report.model || report.version)
          emit({ type: "run_meta", runId: run.runId, model: report.model, version: report.version });
      } catch (error) {
        outcome = { status: "error", detail: errorText(error) };
      }
      if (outcome.status === "error") item({ id: randomUUID(), kind: "error", text: outcome.detail });
      emit({ type: "run_end", runId: run.runId, turnIndex, outcome, wallMs: Date.now() - started });
    }),
  );
  emit({ type: "turn_done", turnIndex });
}

function openSession(ws: Workspace, spec: CompetitorSpec, session: RunState["session"]): AgentSession {
  switch (spec.vendor) {
    case "claude":
      return createClaudeSession(ws, spec, session && "sessionId" in session ? session.sessionId : undefined);
    case "codex":
      return createCodexSession(ws, spec, session && "threadId" in session ? session.threadId : undefined);
  }
}
