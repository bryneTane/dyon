import { createSchema, firstIssue } from "@/lib/domain/schemas";
import { loadCatalog } from "@/lib/server/catalog";
import { createComparison } from "@/lib/server/turns";

export const runtime = "nodejs";

/** Creates a comparison and starts its first turn, which keeps running whatever happens to this request. */
export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const created = createComparison(parsed.data, await loadCatalog());
  if ("error" in created) return Response.json({ error: created.error }, { status: 400 });
  return Response.json({ id: created.id }, { status: 201 });
}
