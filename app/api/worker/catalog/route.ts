import type { Catalog } from "@/lib/domain/catalog";
import { store } from "@/lib/server/store";
import { catalogAuthorized } from "@/lib/server/worker-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () => Response.json({ error: "Unauthorized." }, { status: 401 });

/** The key Claude Code needs to list its models, for the worker started to read them. */
export async function GET(request: Request) {
  if (!catalogAuthorized(request)) return unauthorized();
  return Response.json({ keys: { anthropic: process.env.ANTHROPIC_API_KEY } });
}

/** Both agents' models, as the worker read them. */
export async function PUT(request: Request) {
  if (!catalogAuthorized(request)) return unauthorized();
  const catalog = (await request.json().catch(() => null)) as Catalog | null;
  if (!catalog?.claude || !catalog?.codex) return Response.json({ error: "Invalid catalog." }, { status: 400 });
  const db = await store();
  await db.setValue("catalog", catalog);
  await db.setValue("catalogAt", new Date().toISOString());
  return Response.json({ ok: true });
}
