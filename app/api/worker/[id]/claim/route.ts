import { randomUUID } from "node:crypto";
import type { ClaimResponse } from "@/lib/domain/worker-protocol";
import { roomUrl, signPublishToken } from "@/lib/server/realtime";
import { store } from "@/lib/server/store";
import { workerRoute } from "@/lib/server/worker-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class NoQueuedTurn extends Error {}

/** The worker takes the queued turn: in one transaction, the turn becomes "running" with a new claim. */
export async function POST(request: Request, ctx: RouteContext<"/api/worker/[id]/claim">) {
  const route = await workerRoute(request, ctx.params);
  if ("response" in route) return route.response;
  const { id } = route;
  const claim = randomUUID();
  let turnIndex = -1;
  try {
    const record = await (
      await store()
    ).update(id, (r) => {
      const turn = r.turns.find((t) => t.state === "queued");
      if (!turn) throw new NoQueuedTurn();
      turnIndex = turn.index;
      const now = new Date().toISOString();
      return {
        ...r,
        turns: r.turns.map((t) =>
          t.index === turnIndex ? { ...t, state: "running", startedAt: now, heartbeatAt: now, claim } : t,
        ),
      };
    });
    const body: ClaimResponse = {
      record,
      turnIndex,
      claim,
      keys: { anthropic: process.env.ANTHROPIC_API_KEY, openai: process.env.OPENAI_API_KEY },
      room: { url: roomUrl(id), token: signPublishToken(id) },
    };
    return Response.json(body);
  } catch (error) {
    if (error instanceof NoQueuedTurn) return Response.json({ error: "No queued turn." }, { status: 409 });
    throw error;
  }
}
