import { firstIssue, followUpSchema } from "@/lib/domain/schemas";
import { isId } from "@/lib/server/ids";
import { addTurn } from "@/lib/server/turns";

export const runtime = "nodejs";

/** A follow-up for every run of the comparison. 409 while a turn is queued or running. */
export async function POST(request: Request, ctx: RouteContext<"/api/comparisons/[id]/turns">) {
  const { id } = await ctx.params;
  if (!isId(id)) return Response.json({ error: "This comparison does not exist." }, { status: 404 });
  const parsed = followUpSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const added = addTurn(id, parsed.data.prompt);
  if ("error" in added) return Response.json({ error: added.error }, { status: added.status });
  return Response.json(added, { status: 201 });
}
