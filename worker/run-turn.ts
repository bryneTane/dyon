import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createClaudeSession } from "@/lib/agents/claude";
import { createCodexSession } from "@/lib/agents/codex";
import type { AgentSession, TurnReport } from "@/lib/agents/session";
import type { CompetitorSpec } from "@/lib/domain/catalog";
import { countActions, turnCost, turnTokens } from "@/lib/domain/metrics";
import { applyEvent } from "@/lib/domain/record";
import { HEARTBEAT_MS } from "@/lib/domain/stall";
import { errorText } from "@/lib/domain/text";
import { createStepClock } from "@/lib/domain/timing";
import type {
  ComparisonRecord,
  HistoryEntry,
  RunState,
  RunTurnResult,
  StreamEvent,
  TimelineItem,
} from "@/lib/domain/types";
import type { ClaimResponse } from "@/lib/domain/worker-protocol";
import { workDir } from "@/lib/server/config";
import { createPublisher } from "@/lib/server/realtime";
import {
  archiveRoot,
  createWorkspace,
  markTurnStart,
  openWorkspace,
  restoreRoot,
  runCheck,
  snapshotFiles,
  snapshotKeys,
  workspaceDiff,
  type Workspace,
} from "@/lib/server/workspace";
import type { WorkerApi } from "./api";

/** How often progress is sent while events come in, so a reload never misses more than this. */
const SAVE_EVERY_MS = 1000;

/** A turn still running after this long is stopped, so a stuck agent cannot run (and spend) forever. */
export const TURN_LIMIT_MS = 20 * 60_000;

/** Turns running in this process, to stop them all when the worker is asked to stop. */
const running = new Set<{ abort: AbortController; done: Promise<void> }>();

/**
 * Stops every running turn with `reason` and waits until each one is saved: its runs end "stopped" with the
 * steps they had, so the turns close at once instead of after the missing signs of life.
 */
export async function stopAllTurns(reason: string): Promise<void> {
  for (const { abort } of running) abort.abort(reason);
  await Promise.all([...running].map(({ done }) => done.catch(() => {})));
}

/** Fixed path of a run's files: the same on every worker, so a restored Claude Code session finds its folder. */
const runRoot = (comparisonId: string, runId: string) => join(workDir, comparisonId, runId);

/**
 * Runs the queued turn of a comparison, through the web app's API: every run in parallel, live events to the
 * comparison's room, progress to the web app (every second while events come in, and every 5 s as a sign of
 * life, whose answer carries a stop request), each run's files to storage after its turn.
 */
export async function runTurnJob(api: WorkerApi): Promise<void> {
  const claimed = await api.claim();
  if (!claimed) return console.log("Nothing to run: the turn was taken or closed.");
  const { turnIndex, claim, keys } = claimed;
  let record = claimed.record;
  const publish = createPublisher(claimed.room.url, claimed.room.token);
  const turn = () => record.turns[turnIndex];
  const abort = new AbortController();

  // Progress: the items of the runs that changed since the last call, sent one call at a time.
  const changed = new Set<string>();
  let lastSave = 0;
  let claimLost = false;
  let saving: Promise<unknown> = Promise.resolve();
  const save = (final = false, history: HistoryEntry[] = []) => {
    lastSave = Date.now();
    saving = saving
      .then(async () => {
        if (claimLost) return;
        const runs = [...changed];
        changed.clear();
        const t = turn();
        const answer = await api.progress({
          claim,
          turnIndex,
          seq: record.seq,
          final,
          items: Object.fromEntries(runs.map((runId) => [runId, t.items[runId] ?? []])),
          results: t.results,
          error: t.error,
          runs: record.runs,
          history,
        });
        if (answer.claimLost) {
          claimLost = true;
          abort.abort("This turn was closed while it ran.");
        } else if (answer.stopRequested && !abort.signal.aborted) abort.abort("Stopped by the user.");
      })
      .catch((error) => console.error("Could not send progress:", errorText(error)));
    return saving;
  };
  const emit = (event: StreamEvent) => {
    const seq = record.seq + 1;
    record = { ...applyEvent(record, event), seq };
    if ("runId" in event) changed.add(event.runId);
    if (Date.now() - lastSave >= SAVE_EVERY_MS) void save();
    publish({ seq, event });
  };

  let finished = () => {};
  const entry = { abort, done: new Promise<void>((resolve) => (finished = resolve)) };
  running.add(entry);
  emit({ type: "turn_start", turnIndex, prompt: turn().prompt, startedAt: turn().startedAt });
  const heartbeat = setInterval(() => {
    if (Date.now() - lastSave >= HEARTBEAT_MS) void save();
  }, 1000);
  const limit = setTimeout(() => abort.abort(`Stopped at the ${TURN_LIMIT_MS / 60_000}-minute limit.`), TURN_LIMIT_MS);
  const history: HistoryEntry[] = [];
  try {
    await Promise.all(record.info.runs.map((run) => runOne(run.runId)));
  } catch (error) {
    emit({ type: "fatal", message: errorText(error) });
  } finally {
    clearTimeout(limit);
    clearInterval(heartbeat);
  }
  // The turn is closed (and the comparison free) before tabs learn it is over, so a follow-up sent at once is
  // accepted.
  const done: StreamEvent = { type: "turn_done", turnIndex };
  const seq = record.seq + 1;
  record = { ...applyEvent(record, done), seq };
  await save(true, history);
  if (!claimLost) publish({ seq, event: done });
  running.delete(entry);
  finished();

  async function runOne(runId: string) {
    const run = record.info.runs.find((r) => r.runId === runId)!;
    const competitor = record.info.competitors.find((c) => c.id === run.competitorId)!;
    const stamp = createStepClock();
    const item = (i: TimelineItem) => emit({ type: "item", runId, turnIndex, item: stamp(i) });
    const started = Date.now();
    const before = record.runs[runId];
    let report: TurnReport;
    let ws: Workspace | null = null;
    try {
      ws = await prepare(api, record, runId);
      await markTurnStart(ws);
      const session = openSession(ws, competitor, keys, before?.session ?? null);
      report = await session.send(turn().prompt, item, abort.signal);
      setRun(runId, {
        session: session.state(),
        // A turn that reported nothing keeps the previous totals, so the next turn's difference is right.
        cumulative: report.cumulative ?? before?.cumulative ?? null,
        model: report.model ?? before?.model ?? null,
      });
      if (report.model || report.version)
        emit({ type: "run_meta", runId, model: report.model, version: report.version });
    } catch (error) {
      report = { outcome: { status: "error", detail: errorText(error) }, cumulative: null };
      item({ id: randomUUID(), kind: "error", text: errorText(error) });
    }
    const wallMs = Date.now() - started;
    if (report.outcome.status === "aborted") report.outcome.detail = String(abort.signal.reason ?? "Stopped.");
    const check = record.info.check;
    // The check runs after the agent's turn, in its workspace; the agent never sees the command or its result.
    const ran = check && ws && !abort.signal.aborted ? await runCheck(ws, check, abort.signal) : null;
    // A check cut short by a stop says nothing about the work: not kept.
    const checked = ran && !abort.signal.aborted ? ran : null;
    if (checked) {
      const { output, ...rest } = checked;
      item({ id: randomUUID(), kind: "check", ...rest, output, status: checked.passed ? "ok" : "failed" });
    }
    const counts = countActions(turn().items[runId] ?? []);
    const diff = ws ? await workspaceDiff(ws).catch(() => null) : null;
    // The run's files and agent session, so the next turn, the Files tab and the report work from any machine.
    if (ws)
      await saveRun(api, record.info.id, runId, turnIndex, ws)
        .then((archive) => setRun(runId, { ...record.runs[runId], archive }))
        .catch((error) => console.error(`Could not save the files of ${runId}:`, errorText(error)));
    const result: RunTurnResult = {
      wallMs,
      tokens: turnTokens(report.cumulative, before?.cumulative ?? null),
      // Codex's web actions are not priced (see lib/domain/pricing.ts); Claude Code's are, per search.
      cost: turnCost(
        report.cumulative,
        before?.cumulative ?? null,
        competitor.vendor === "codex" ? counts.webSearches : 0,
      ),
      outcome: report.outcome,
      check: checked,
      counts,
      diff,
    };
    emit({ type: "run_done", runId, turnIndex, result });
    history.push({
      at: new Date().toISOString(),
      comparisonId: record.info.id,
      turnIndex,
      prompt: turn().prompt,
      vendor: competitor.vendor,
      requestedModel: competitor.model,
      effort: competitor.effort,
      check,
      runIndex: run.index,
      model: record.runs[runId]?.model ?? null,
      wallMs,
      tokens: result.tokens,
      costUsd: result.cost.computedUsd,
      outcome: report.outcome.status,
      checkPassed: checked ? checked.passed : null,
    });
  }

  function setRun(runId: string, state: RunState) {
    record = { ...record, runs: { ...record.runs, [runId]: state } };
  }
}

/**
 * The run's folder, ready for this turn. First turn: a new workspace, saved at once, so a follow-up after a turn
 * cut short starts from it on any worker. Later turns: this machine's copy if it is exactly the last saved state,
 * else the saved state from storage. The marker that says so is removed when a turn starts and written back when
 * the turn is saved: the files of a turn cut short are never reused, the same way locally and hosted.
 */
async function prepare(api: WorkerApi, record: ComparisonRecord, runId: string): Promise<Workspace> {
  const root = runRoot(record.info.id, runId);
  const marker = join(root, ".dyon-archive");
  const archive = record.runs[runId]?.archive;
  let ws: Workspace;
  if (!archive) {
    ws = await createWorkspace(root);
    await saveRun(api, record.info.id, runId, -1, ws);
  } else {
    const local = existsSync(marker) ? await readFile(marker, "utf8").catch(() => "") : "";
    if (local !== archive.key) {
      const data = await api.getBlob(archive.key);
      if (!data) throw new Error("The saved files of this run are missing.");
      await restoreRoot(root, data);
    }
    ws = await openWorkspace(root);
  }
  await rm(marker, { force: true });
  return ws;
}

/**
 * Uploads the run's state (workspace and agent home, to continue from) and what the web app shows of it (file
 * list and zip), then marks the local copy as matching that upload.
 */
async function saveRun(api: WorkerApi, comparisonId: string, runId: string, turn: number, ws: Workspace) {
  const key = `runs/${comparisonId}/${runId}/${turn < 0 ? "start" : `turn-${turn}`}.tgz`;
  const marker = join(ws.root, ".dyon-archive");
  await rm(marker, { force: true });
  const snapshot = await snapshotFiles(ws);
  const keys = snapshotKeys(key);
  const data = await archiveRoot(ws.root);
  await Promise.all([
    api.putBlob(keys.list, Buffer.from(JSON.stringify(snapshot.list)), "application/json"),
    snapshot.zip ? api.putBlob(keys.zip, snapshot.zip, "application/zip") : Promise.resolve(),
    api.putBlob(key, data, "application/gzip"),
  ]);
  await writeFile(marker, key);
  return { key, turn };
}

function openSession(
  ws: Workspace,
  spec: CompetitorSpec,
  keys: ClaimResponse["keys"],
  session: RunState["session"],
): AgentSession {
  // Fails this run at once, with what to do; the other runs go on.
  const [key, name] =
    spec.vendor === "claude" ? [keys.anthropic, "ANTHROPIC_API_KEY"] : [keys.openai, "OPENAI_API_KEY"];
  if (!key) throw new Error(`No ${name} is set for Dyon: add it to .env.local, then restart Dyon.`);
  switch (spec.vendor) {
    case "claude":
      return createClaudeSession(ws, spec, key, session && "sessionId" in session ? session.sessionId : undefined);
    case "codex":
      return createCodexSession(ws, spec, key, session && "threadId" in session ? session.threadId : undefined);
  }
}
