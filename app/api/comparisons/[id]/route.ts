import { roomUrl, signRoomToken } from "@/lib/server/realtime";
import { loadRecord } from "@/lib/server/turns";

export const runtime = "nodejs";

/** The saved comparison, which a page loads before following its live events in the relay room. */
export async function GET(_request: Request, ctx: RouteContext<"/api/comparisons/[id]">) {
  const { id } = await ctx.params;
  const record = await loadRecord(id);
  if (!record) return Response.json({ error: "This comparison does not exist." }, { status: 404 });
  // Never sent to the browser: the user's encrypted keys of a queued turn, and the worker's claim.
  const turns = record.turns.map(({ keys: _keys, claim: _claim, ...turn }) => turn);
  // The live room, with a join token for this comparison only.
  return Response.json({ record: { ...record, turns }, room: { url: roomUrl(id), token: signRoomToken(id) } });
}
