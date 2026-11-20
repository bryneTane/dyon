import { isId } from "@/lib/server/ids";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";

/** The saved comparison, which a page loads before following its live events. */
export async function GET(_request: Request, ctx: RouteContext<"/api/comparisons/[id]">) {
  const { id } = await ctx.params;
  const record = isId(id) ? store().get(id) : null;
  if (!record) return Response.json({ error: "This comparison does not exist." }, { status: 404 });
  return Response.json({ record });
}
