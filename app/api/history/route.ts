import { scoreboard } from "@/lib/domain/scoreboard";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The scoreboard over every recorded run, and the most recent runs. */
export async function GET() {
  const entries = store().history(5000);
  return Response.json({ scoreboard: scoreboard(entries), entries: entries.slice(0, 100) });
}
