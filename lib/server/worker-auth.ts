import "server-only";
import { workerSecret } from "./config";
import { isId } from "./ids";
import { signToken, verifyToken } from "./tokens";

/**
 * The worker's only credential: a token for ONE comparison, valid 45 minutes (queue wait, 20-minute turn,
 * saving). The worker holds no database, storage or relay credentials; everything goes through the web app's
 * /api/worker/<id> routes with this token. The agents run commands on the worker's machine: a token they
 * might read exposes one comparison, briefly.
 */
const TTL_S = 45 * 60;

/** The subject of the token a worker gets to report the agents' models (no comparison involved). */
export const CATALOG_SUBJECT = "catalog";

export function signWorkerToken(subject: string): string {
  return signToken(workerSecret, "dyon-worker:v1", subject, TTL_S);
}

function bearer(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : new URL(request.url).searchParams.get("token");
}

/** True if the request carries a worker token for reporting the models. */
export function catalogAuthorized(request: Request): boolean {
  return verifyToken(workerSecret, "dyon-worker:v1", CATALOG_SUBJECT, bearer(request));
}

/** The comparison id of a worker route, if the request carries a valid worker token for it. */
export async function workerRoute(
  request: Request,
  params: Promise<{ id: string }>,
): Promise<{ id: string } | { response: Response }> {
  const { id } = await params;
  if (!isId(id) || !verifyToken(workerSecret, "dyon-worker:v1", id, bearer(request)))
    return { response: Response.json({ error: "Unauthorized." }, { status: 401 }) };
  return { id };
}
