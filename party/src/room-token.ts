// Token verification for the relay (Web Crypto, runs on Cloudflare). Tokens are signed by the web app
// (lib/server/tokens.ts): `<exp>.<sig>`, sig = base64url(HMAC-SHA256(PARTYKIT_SECRET, "<purpose>:<room>:<exp>")).
//   dyon-room:v1     join the room (browser), 10 minutes
//   dyon-publish:v1  publish to the room (the worker of that comparison), 45 minutes

export type Purpose = "dyon-room:v1" | "dyon-publish:v1";
/** Longest lifetime the web app gives a token, plus clock skew: anything further ahead is forged or broken. */
const MAX_AHEAD_S = 45 * 60 + 60;

function base64urlDecode(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** False when the token is missing, malformed, expired, too far ahead, for another room or purpose, or when the secret is unset. */
export async function verifyToken(
  purpose: Purpose,
  room: string,
  token: string | null,
  secret: string | undefined,
  nowS: number,
): Promise<boolean> {
  if (!secret || !token) return false;
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isSafeInteger(exp) || exp <= nowS || exp > nowS + MAX_AHEAD_S) return false;
  const sig = base64urlDecode(m[2]);
  if (!sig || sig.length !== 32) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "verify",
  ]);
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(`${purpose}:${room}:${exp}`));
}

export async function guardRoom(
  req: Request,
  room: string,
  secret: string | undefined,
  nowS: number,
): Promise<Response | undefined> {
  const token = new URL(req.url).searchParams.get("token");
  if (await verifyToken("dyon-room:v1", room, token, secret, nowS)) return undefined;
  return new Response("Unauthorized", { status: 401 });
}
