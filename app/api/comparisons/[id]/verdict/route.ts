import { firstIssue, verdictSchema } from "@/lib/domain/schemas";
import type { Verdict } from "@/lib/domain/types";
import { store } from "@/lib/server/store";
import { loadRecord } from "@/lib/server/turns";

export const runtime = "nodejs";

/** POST { winner: competitor id | "tie" | "all_bad", note } records the user's verdict on the comparison. */
export async function POST(request: Request, ctx: RouteContext<"/api/comparisons/[id]/verdict">) {
  const { id } = await ctx.params;
  const parsed = verdictSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { winner, note } = parsed.data;
  const record = loadRecord(id);
  if (!record) return Response.json({ error: "This comparison does not exist." }, { status: 404 });
  if (record.status === "busy")
    return Response.json({ error: "Wait for the current turn to finish." }, { status: 409 });
  if (![...record.info.competitors.map((c) => c.id), "tie", "all_bad"].includes(winner))
    return Response.json({ error: "Pick a competitor, a tie, or all bad." }, { status: 400 });
  let verdict: Verdict | null = null;
  store().update(id, (r) => {
    // Blind only while the names were still hidden: the first verdict of a blind comparison, kept once earned.
    const blind = r.info.blind && (r.verdict === null || r.verdict.blind);
    verdict = { winner, note, blind, at: new Date().toISOString() };
    return { ...r, verdict };
  });
  return Response.json({ verdict });
}
