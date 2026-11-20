import { gunzipSync } from "node:zlib";

/** JSON body, gzip-compressed by the worker when large (Vercel caps request bodies at 4.5 MB). */
export async function workerJson(request: Request): Promise<unknown> {
  const raw = Buffer.from(await request.arrayBuffer());
  const text =
    request.headers.get("content-encoding") === "gzip" ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  return JSON.parse(text);
}
