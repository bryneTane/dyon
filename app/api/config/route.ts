import { serverKeyVendors } from "@/lib/server/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which agents this server can run without the user's own key (locally only; none when hosted). */
export function GET() {
  return Response.json({ serverKeys: serverKeyVendors() });
}
