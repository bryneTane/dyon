import "server-only";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createClaudeSession } from "@/lib/agents/claude";
import { createCodexSession } from "@/lib/agents/codex";
import type { AgentSession, TurnReport } from "@/lib/agents/session";
import { applyEvent } from "@/lib/domain/record";
import { errorText } from "@/lib/domain/text";
import { createStepClock } from "@/lib/domain/timing";
import type { CompetitorSpec } from "@/lib/domain/catalog";
import { countActions, turnCost, turnTokens } from "@/lib/domain/metrics";
import type { HistoryEntry, RunState, RunTurnResult, StreamEvent, TimelineItem } from "@/lib/domain/types";
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
  const history: HistoryEntry[] = [];
  await Promise.all(
    record.info.runs.map(async (run) => {
      const competitor = record!.info.competitors.find((c) => c.id === run.competitorId)!;
      const stamp = createStepClock();
      const item = (i: TimelineItem) => emit({ type: "item", runId: run.runId, turnIndex, item: stamp(i) });
      const started = Date.now();
      const saved = record!.runs[run.runId];
      let report: TurnReport;
      try {
        const root = join(workDir, comparisonId, run.runId);
        const ws = turnIndex === 0 ? await createWorkspace(root) : await openWorkspace(root);
        const session = openSession(ws, competitor, saved?.session ?? null);
        report = await session.send(turn.prompt, item, abort.signal);
        record = {
          ...record!,
          runs: {
            ...record!.runs,
            [run.runId]: {
              session: session.state(),
              // A turn that reported nothing keeps the previous totals, so the next turn's difference is right.
              cumulative: report.cumulative ?? saved?.cumulative ?? null,
              model: report.model ?? saved?.model ?? null,
            },
          },
        };
        if (report.model || report.version)
          emit({ type: "run_meta", runId: run.runId, model: report.model, version: report.version });
      } catch (error) {
        report = { outcome: { status: "error", detail: errorText(error) }, cumulative: null };
      }
      const wallMs = Date.now() - started;
      if (report.outcome.status === "error") item({ id: randomUUID(), kind: "error", text: report.outcome.detail });
      const counts = countActions(record!.turns[turnIndex].items[run.runId] ?? []);
      const before = saved?.cumulative ?? null;
      const result: RunTurnResult = {
        wallMs,
        tokens: turnTokens(report.cumulative, before),
        // Codex's web actions are not priced (see lib/domain/pricing.ts); Claude Code's are, per search.
        cost: turnCost(report.cumulative, before, competitor.vendor === "codex" ? counts.webSearches : 0),
        outcome: report.outcome,
        check: null,
        counts,
        diff: null,
      };
      emit({ type: "run_done", runId: run.runId, turnIndex, result });
      history.push({
        at: new Date().toISOString(),
        comparisonId,
        turnIndex,
        prompt: turn.prompt,
        vendor: competitor.vendor,
        requestedModel: competitor.model,
        effort: competitor.effort,
        check: record!.info.check,
        runIndex: run.index,
        model: record!.runs[run.runId]?.model ?? null,
        wallMs,
        tokens: result.tokens,
        costUsd: result.cost.computedUsd,
        outcome: report.outcome.status,
        checkPassed: null,
      });
    }),
  );
  store().appendHistory(history);
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
