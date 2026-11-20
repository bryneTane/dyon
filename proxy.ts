import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "dyon_token";

/**
 * Content Security Policy: the browser runs only the scripts this server sent with this request's nonce, and sends
 * data only to this site and the live relay. If text written by an agent (or a prompt) ever got injected as a
 * script, it could neither run nor send the user's API keys elsewhere. Pages are rendered per request (layout.tsx),
 * so each gets a fresh nonce, which Next.js adds to its own scripts.
 */
function contentSecurityPolicy(nonce: string): string {
  const relay = new URL(process.env.RELAY_URL ?? "http://localhost:3002");
  const relaySocket = `${relay.protocol === "https:" ? "wss:" : "ws:"}//${relay.host}`;
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // 'strict-dynamic': scripts loaded by a trusted script are trusted. 'unsafe-eval' only in development.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline styles stay allowed: server-rendered style attributes cannot carry a nonce, and styles cannot read keys.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "worker-src 'self' blob:",
    `connect-src 'self' ${relay.origin} ${relaySocket}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Passes the request on with the policy: on the request (Next.js reads the nonce there) and on the response. */
function next(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "same-origin");
  return response;
}

/**
 * Access gate. A prompt makes agents run shell commands, and each turn costs API credits: a public deployment
 * must not be open to anyone. Locally, leave DYON_TOKEN unset.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Reports are shared by link (an unguessable id) and read-only: no token, so link previews work too.
  if (pathname.startsWith("/report/")) return next(request);
  // The worker has its own token for one comparison (lib/server/worker-auth.ts), checked by each route.
  if (pathname.startsWith("/api/worker/")) return NextResponse.next();
  const token = process.env.DYON_TOKEN;
  if (!token) {
    if (process.env.VERCEL) return new NextResponse("DYON_TOKEN is not set on this deployment.", { status: 503 });
    return next(request);
  }
  // Opening the link with ?token=… once sets a cookie, then the address is cleaned.
  if (request.nextUrl.searchParams.get("token") === token) {
    const clean = request.nextUrl.clone();
    clean.searchParams.delete("token");
    const response = NextResponse.redirect(clean);
    response.cookies.set(COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
    return response;
  }
  if (request.cookies.get(COOKIE)?.value === token) return next(request);
  return new NextResponse("Unauthorized. Open the link with ?token=<access token>.", { status: 401 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
