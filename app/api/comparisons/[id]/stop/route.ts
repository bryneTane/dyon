import { stopTurn } from "@/lib/server/runner";
import { store } from "@/lib/server/store";
import { loadRecord } from "@/lib/server/turns";

export const runtime = "nodejs";

/** Stops the running turn: every run ends "stopped" with the steps it had, and a follow-up is accepted after. */
export async function POST(_request: Request, ctx: RouteContext<"/api/comparisons/[id]/stop">) {
  const { id } = await ctx.params;
  const record = loadRecord(id);
  if (!record) return Response.json({ error: "This comparison does not exist." }, { status: 404 });
  if (record.status !== "busy") return Response.json({ stopping: false });
  store().update(id, (r) => ({ ...r, stopRequested: true }));
  return Response.json({ stopping: stopTurn(id) });
}
