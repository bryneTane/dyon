import "server-only";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createClaudeSession } from "@/lib/agents/claude";
import { createCodexSession } from "@/lib/agents/codex";
import type { AgentSession, TurnReport } from "@/lib/agents/session";
import { applyEvent } from "@/lib/domain/record";
import { HEARTBEAT_MS } from "@/lib/domain/stall";
import { errorText } from "@/lib/domain/text";
import { createStepClock } from "@/lib/domain/timing";
import type { CompetitorSpec } from "@/lib/domain/catalog";
import { countActions, turnCost, turnTokens } from "@/lib/domain/metrics";
import type { HistoryEntry, RunState, RunTurnResult, StreamEvent, TimelineItem } from "@/lib/domain/types";
import { workDir } from "./config";
import { publish } from "./events";
import { store } from "./store";
import { createWorkspace, markTurnStart, openWorkspace, runCheck, workspaceDiff, type Workspace } from "./workspace";

/** How often a running turn's record is saved, so a reload never misses more than this. */
const SAVE_EVERY_MS = 1000;

/** A turn still running after this long is stopped, so a stuck agent cannot run (and spend) forever. */
export const TURN_LIMIT_MS = 20 * 60_000;

/** Turns running in this process, to stop them all when the worker is asked to stop. */
const running = new Map<string, { abort: AbortController; done: Promise<void> }>();

/**
 * Stops every running turn with `reason` and waits until each one is saved: its runs end "stopped" with the
 * steps they had, so the turns close at once instead of after the missing signs of life.
 */
export async function stopAllTurns(reason: string): Promise<void> {
  for (const { abort } of running.values()) abort.abort(reason);
  await Promise.all([...running.values()].map(({ done }) => done.catch(() => {})));
}

/**
 * Runs a queued turn to its end, in the worker: closing or refreshing the page does not stop it.
 * Every event is numbered, applied to the record kept in memory, and published to open tabs. The record is
 * saved at most every second, at every sign of life (every 5 s, which also reads a stop request), and before
 * the turn's last event.
 */
export async function runTurn(comparisonId: string, turnIndex: number): Promise<void> {
  const db = await store();
  let record = await db.get(comparisonId);
  if (!record) return;
  const turn = record.turns[turnIndex];
  const abort = new AbortController();
  let lastSave = 0;
  let saving: Promise<unknown> = Promise.resolve();
  const save = () => {
    lastSave = Date.now();
    const current = record!;
    // Saves run one after another, in order. The web app writes the stop request and the verdict (only saved
    // while no turn runs): both are kept from the saved record.
    saving = saving
      .then(() =>
        db.update(comparisonId, (saved) => ({
          ...current,
          stopRequested: saved.stopRequested,
          verdict: saved.verdict,
        })),
      )
      .then((saved) => {
        if (saved.stopRequested && !abort.signal.aborted) abort.abort("Stopped by the user.");
      })
      .catch((error) => console.error(`Could not save ${comparisonId}:`, error));
  };
  const emit = (event: StreamEvent) => {
    const seq = record!.seq + 1;
    record = { ...applyEvent(record!, event), seq };
    // The saved record is idle before tabs learn the turn is over, so a follow-up sent at once is accepted.
    if (event.type === "turn_done" || Date.now() - lastSave >= SAVE_EVERY_MS) save();
    publish(comparisonId, { seq, event });
  };
  const beat = () => {
    const now = new Date().toISOString();
    record = { ...record!, turns: record!.turns.map((t) => (t.index === turnIndex ? { ...t, heartbeatAt: now } : t)) };
  };

  let finished = () => {};
  running.set(comparisonId, { abort, done: new Promise<void>((resolve) => (finished = resolve)) });
  beat();
  emit({ type: "turn_start", turnIndex, prompt: turn.prompt, startedAt: turn.startedAt });
  const heartbeat = setInterval(() => {
    beat();
    save();
  }, HEARTBEAT_MS);
  const limit = setTimeout(() => abort.abort(`Stopped at the ${TURN_LIMIT_MS / 60_000}-minute limit.`), TURN_LIMIT_MS);
  const history: HistoryEntry[] = [];
  const check = record.info.check;
  try {
    await runs();
  } finally {
    clearTimeout(limit);
    clearInterval(heartbeat);
  }
  await db.appendHistory(history);
  emit({ type: "turn_done", turnIndex });
  await saving;
  running.delete(comparisonId);
  finished();

  async function runs() {
    await Promise.all(
      record!.info.runs.map(async (run) => {
        const competitor = record!.info.competitors.find((c) => c.id === run.competitorId)!;
        const stamp = createStepClock();
        const item = (i: TimelineItem) => emit({ type: "item", runId: run.runId, turnIndex, item: stamp(i) });
        const started = Date.now();
        const saved = record!.runs[run.runId];
        let report: TurnReport;
        let ws: Workspace | null = null;
        try {
          const root = join(workDir, comparisonId, run.runId);
          ws = turnIndex === 0 ? await createWorkspace(root) : await openWorkspace(root);
          await markTurnStart(ws);
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
          item({ id: randomUUID(), kind: "error", text: errorText(error) });
        }
        const wallMs = Date.now() - started;
        if (report.outcome.status === "aborted") report.outcome.detail = String(abort.signal.reason ?? "Stopped.");
        // The check runs after the agent's turn, in its workspace; the agent never sees the command or its result.
        const ran = check && ws && !abort.signal.aborted ? await runCheck(ws, check, abort.signal) : null;
        // A check cut short by a stop says nothing about the work: not kept.
        const checked = ran && !abort.signal.aborted ? ran : null;
        if (checked) {
          const { output, ...rest } = checked;
          item({ id: randomUUID(), kind: "check", ...rest, output, status: checked.passed ? "ok" : "failed" });
        }
        const counts = countActions(record!.turns[turnIndex].items[run.runId] ?? []);
        const before = saved?.cumulative ?? null;
        const result: RunTurnResult = {
          wallMs,
          tokens: turnTokens(report.cumulative, before),
          // Codex's web actions are not priced (see lib/domain/pricing.ts); Claude Code's are, per search.
          cost: turnCost(report.cumulative, before, competitor.vendor === "codex" ? counts.webSearches : 0),
          outcome: report.outcome,
          check: checked,
          counts,
          diff: ws ? await workspaceDiff(ws).catch(() => null) : null,
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
          checkPassed: checked ? checked.passed : null,
        });
      }),
    );
  }
}

/** The key each agent needs, read from `.env.local`. */
const KEYS = { claude: "ANTHROPIC_API_KEY", codex: "OPENAI_API_KEY" } as const;

function openSession(ws: Workspace, spec: CompetitorSpec, session: RunState["session"]): AgentSession {
  // Fails this run at once, with what to do; the other runs go on.
  if (!process.env[KEYS[spec.vendor]]) throw new Error(`Add ${KEYS[spec.vendor]} to .env.local, then restart Dyon.`);
  switch (spec.vendor) {
    case "claude":
      return createClaudeSession(ws, spec, session && "sessionId" in session ? session.sessionId : undefined);
    case "codex":
      return createCodexSession(ws, spec, session && "threadId" in session ? session.threadId : undefined);
  }
}
