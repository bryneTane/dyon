import { blobsRequestSchema, type BlobsResponse } from "@/lib/domain/worker-protocol";
import { blobs } from "@/lib/server/blobs";
import { workerRoute } from "@/lib/server/worker-auth";
import { workerJson } from "../body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Short-lived links for the worker to upload or read its comparison's files directly in storage: no storage
 * credentials on the worker, no file bytes through this app. Locally, where storage is a folder, the links point
 * at /api/worker/<id>/blob, which serves the bytes.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/worker/[id]/blobs">) {
  const route = await workerRoute(request, ctx.params);
  if ("response" in route) return route.response;
  const parsed = blobsRequestSchema.safeParse(await workerJson(request).catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const prefix = `runs/${route.id}/`;
  const keys = [...parsed.data.put.map((p) => p.key), ...parsed.data.get];
  if (keys.some((k) => !k.startsWith(prefix) || k.includes("..")))
    return Response.json({ error: "Keys must be in this comparison's folder." }, { status: 403 });
  const storage = await blobs();
  const local = (key: string) => {
    const url = new URL(`/api/worker/${route.id}/blob`, request.url);
    url.searchParams.set("key", key);
    url.searchParams.set("token", (request.headers.get("authorization") ?? "").slice(7));
    return url.toString();
  };
  const body: BlobsResponse = { put: {}, get: {} };
  for (const { key, contentType } of parsed.data.put)
    body.put[key] = (await storage.signedUrl(key, "PUT", contentType)) ?? local(key);
  for (const key of parsed.data.get) body.get[key] = (await storage.signedUrl(key, "GET")) ?? local(key);
  return Response.json(body);
}
