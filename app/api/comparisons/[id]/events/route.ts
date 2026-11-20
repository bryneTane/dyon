import { subscribe } from "@/lib/server/events";
import { isId } from "@/lib/server/ids";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";

/** Comment line sent regularly so proxies and browsers keep an idle connection open. */
const PING_EVERY_MS = 15_000;

/** Server-Sent Events: every numbered event of the comparison after `?after=<seq>`, as it happens. */
export async function GET(request: Request, ctx: RouteContext<"/api/comparisons/[id]/events">) {
  const { id } = await ctx.params;
  if (!isId(id) || !store().get(id))
    return Response.json({ error: "This comparison does not exist." }, { status: 404 });
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => controller.enqueue(encoder.encode(text));
      const unsubscribe = subscribe(id, after, (event) => write(`data: ${JSON.stringify(event)}\n\n`));
      const ping = setInterval(() => write(": ping\n\n"), PING_EVERY_MS);
      stop = () => {
        clearInterval(ping);
        unsubscribe();
      };
      request.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
