import { verifyToken } from "./room-token";

/**
 * POST /parties/main/<room>: broadcasts the body to every socket in the room, with
 * `Authorization: Publish <token>`, a publish token for this room (given to the worker running its turn).
 * Kept free of Worker and Durable Object types so it can be tested in plain Node.
 */
export async function handlePublish(
  req: Request,
  roomId: string,
  secret: string | undefined,
  broadcast: (body: string) => void,
  nowS = Math.floor(Date.now() / 1000),
): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!secret) return new Response("Server misconfigured: PARTYKIT_SECRET not set", { status: 500 });
  const auth = req.headers.get("authorization") ?? "";
  const allowed =
    auth.startsWith("Publish ") && (await verifyToken("dyon-publish:v1", roomId, auth.slice(8), secret, nowS));
  if (!allowed) return new Response("Unauthorized", { status: 401 });
  broadcast(await req.text());
  return new Response("ok", { status: 200 });
}
