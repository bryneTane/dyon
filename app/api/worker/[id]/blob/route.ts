import { blobs } from "@/lib/server/blobs";
import { workerRoute } from "@/lib/server/worker-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local storage only: what a signed storage link does when storage is a folder (see ../blobs/route.ts).

function keyOf(request: Request, id: string): string | null {
  const key = new URL(request.url).searchParams.get("key");
  return key && key.startsWith(`runs/${id}/`) && !key.includes("..") ? key : null;
}

export async function PUT(request: Request, ctx: RouteContext<"/api/worker/[id]/blob">) {
  const route = await workerRoute(request, ctx.params);
  if ("response" in route) return route.response;
  const key = keyOf(request, route.id);
  if (!key) return Response.json({ error: "Invalid key." }, { status: 403 });
  await (
    await blobs()
  ).put(key, Buffer.from(await request.arrayBuffer()), request.headers.get("content-type") ?? undefined);
  return new Response(null, { status: 200 });
}

export async function GET(request: Request, ctx: RouteContext<"/api/worker/[id]/blob">) {
  const route = await workerRoute(request, ctx.params);
  if ("response" in route) return route.response;
  const key = keyOf(request, route.id);
  if (!key) return Response.json({ error: "Invalid key." }, { status: 403 });
  const data = await (await blobs()).get(key);
  return data ? new Response(new Uint8Array(data)) : new Response("Not found", { status: 404 });
}
