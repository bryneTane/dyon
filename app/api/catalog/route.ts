import { storedCatalog } from "@/lib/server/turns";

export const runtime = "nodejs";

/** The models and effort levels each agent reports. */
export async function GET() {
  return Response.json({ catalog: await storedCatalog() });
}
