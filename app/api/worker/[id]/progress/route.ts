import type { HistoryEntry } from "@/lib/domain/types";
import { progressRequestSchema, type ProgressResponse } from "@/lib/domain/worker-protocol";
import { store } from "@/lib/server/store";
import { workerRoute } from "@/lib/server/worker-auth";
import { workerJson } from "../body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Saves the worker's progress on its turn (also its heartbeat) and answers with the stop request. */
export async function POST(request: Request, ctx: RouteContext<"/api/worker/[id]/progress">) {
  const route = await workerRoute(request, ctx.params);
  if ("response" in route) return route.response;
  const parsed = progressRequestSchema.safeParse(await workerJson(request).catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid progress." }, { status: 400 });
  const p = parsed.data;
  const db = await store();
  let claimLost = false;
  const saved = await db.update(route.id, (r) => {
    const turn = r.turns[p.turnIndex];
    // Closed as stalled, or taken by another worker: this worker's writes are refused.
    if (!turn || turn.state !== "running" || turn.claim !== p.claim) {
      claimLost = true;
      return r;
    }
    const now = new Date().toISOString();
    return {
      ...r,
      seq: Math.max(r.seq, p.seq),
      runs: p.runs,
      status: p.final ? "idle" : r.status,
      stopRequested: p.final ? false : r.stopRequested,
      turns: r.turns.map((t) =>
        t.index === p.turnIndex
          ? {
              ...t,
              items: { ...t.items, ...p.items },
              results: { ...t.results, ...p.results },
              heartbeatAt: now,
              ...(p.error ? { error: p.error } : {}),
              ...(p.final ? { state: "done" as const, claim: undefined } : {}),
            }
          : t,
      ),
    };
  });
  // Written once: a repeated final call finds the turn closed (claimLost) and adds nothing.
  if (p.final && !claimLost && p.history.length) await db.appendHistory(p.history as HistoryEntry[]);
  const body: ProgressResponse = { stopRequested: !claimLost && saved.stopRequested, claimLost };
  return Response.json(body);
}
