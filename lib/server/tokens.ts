import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived capability tokens: `<exp>.<sig>`, sig = base64url(HMAC-SHA256(secret, "<purpose>:<subject>:<exp>")).
 * A token proves the web app granted one purpose (join a room, publish to it) on one subject until it expires;
 * it carries no other power.
 */
export type TokenPurpose = "dyon-room:v1" | "dyon-publish:v1";

export function signToken(
  secret: string,
  purpose: TokenPurpose,
  subject: string,
  ttlS: number,
  nowS = Math.floor(Date.now() / 1000),
): string {
  if (!secret) throw new Error(`Cannot sign a ${purpose} token: no secret configured.`);
  const exp = nowS + ttlS;
  return `${exp}.${createHmac("sha256", secret).update(`${purpose}:${subject}:${exp}`).digest("base64url")}`;
}

export function verifyToken(
  secret: string,
  purpose: TokenPurpose,
  subject: string,
  token: string | null | undefined,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !token) return false;
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp <= nowS) return false;
  const expected = createHmac("sha256", secret).update(`${purpose}:${subject}:${exp}`).digest();
  const given = Buffer.from(m[2], "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
