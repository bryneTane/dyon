import { workerSecret, workerUrl } from "@/lib/server/config";
import { isId } from "@/lib/server/ids";

export const runtime = "nodejs";

/**
 * Server-Sent Events: every numbered event of the comparison after `?after=<seq>`, as it happens. The events come
 * from the worker that runs the turn; this route passes its stream through.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/comparisons/[id]/events">) {
  const { id } = await ctx.params;
  if (!isId(id)) return Response.json({ error: "This comparison does not exist." }, { status: 404 });
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
  const upstream = await fetch(`${workerUrl}/events/${id}?after=${after}`, {
    headers: { Authorization: `Bearer ${workerSecret}` },
    signal: request.signal,
  }).catch(() => null);
  if (!upstream?.ok || !upstream.body)
    return Response.json({ error: "The worker could not be reached." }, { status: 502 });
  return new Response(upstream.body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
