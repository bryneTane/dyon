import { store } from "@/lib/server/store";
import { loadRecord } from "@/lib/server/turns";

export const runtime = "nodejs";

/**
 * Asks the worker to stop the running turn; it reads the request at its next sign of life (within 5 s). Every
 * run then ends "stopped" with the steps it had, and a follow-up is accepted.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/comparisons/[id]/stop">) {
  const { id } = await ctx.params;
  const record = await loadRecord(id);
  if (!record) return Response.json({ error: "This comparison does not exist." }, { status: 404 });
  if (record.status !== "busy") return Response.json({ stopping: false });
  await (await store()).update(id, (r) => ({ ...r, stopRequested: r.status === "busy" }));
  return Response.json({ stopping: true });
}
