import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "dyon_token";

/**
 * Access gate. A prompt makes agents run shell commands, and each turn costs API credits: a public deployment
 * must not be open to anyone. Locally, leave DYON_TOKEN unset.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Reports are shared by link (an unguessable id) and read-only: no token, so link previews work too.
  if (pathname.startsWith("/report/")) return NextResponse.next();
  // The worker has its own token for one comparison (lib/server/worker-auth.ts), checked by each route.
  if (pathname.startsWith("/api/worker/")) return NextResponse.next();
  const token = process.env.DYON_TOKEN;
  if (!token) {
    if (process.env.VERCEL) return new NextResponse("DYON_TOKEN is not set on this deployment.", { status: 503 });
    return NextResponse.next();
  }
  // Opening the link with ?token=… once sets a cookie, then the address is cleaned.
  if (request.nextUrl.searchParams.get("token") === token) {
    const clean = request.nextUrl.clone();
    clean.searchParams.delete("token");
    const response = NextResponse.redirect(clean);
    response.cookies.set(COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
    return response;
  }
  if (request.cookies.get(COOKIE)?.value === token) return NextResponse.next();
  return new NextResponse("Unauthorized. Open the link with ?token=<access token>.", { status: 401 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
