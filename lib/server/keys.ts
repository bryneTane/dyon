import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Vendor } from "@/lib/domain/catalog";
import type { UserKeys } from "@/lib/domain/schemas";
import { keysSecret, useServerKeys } from "./config";

/**
 * The users' own API keys (bring your own keys). The browser keeps them and sends them with each turn; the server
 * stores them encrypted (AES-256-GCM) on the queued turn only, and hands them to the worker when it claims that
 * turn, deleting them in the same transaction.
 */
function key(): Buffer {
  if (!keysSecret) throw new Error("KEYS_SECRET is not set.");
  return createHash("sha256").update(keysSecret).digest();
}

/** Undefined when no key was given (locally, turns run on the keys of .env.local). */
export function encryptKeys(keys: UserKeys): string | undefined {
  if (!keys.anthropic && !keys.openai) return undefined;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(keys), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decryptKeys(sealed: string): UserKeys {
  const [iv, tag, data] = sealed.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")) as UserKeys;
}

const SERVER_KEY: Record<Vendor, string | undefined> = {
  claude: process.env.ANTHROPIC_API_KEY,
  codex: process.env.OPENAI_API_KEY,
};
const FIELD: Record<Vendor, keyof UserKeys> = { claude: "anthropic", codex: "openai" };
const KEY_NAMES: Record<Vendor, string> = { claude: "Anthropic", codex: "OpenAI" };

/** Vendors this server can run without the user's key (locally only). */
export function serverKeyVendors(): Vendor[] {
  return useServerKeys ? (Object.keys(SERVER_KEY) as Vendor[]).filter((v) => SERVER_KEY[v]) : [];
}

/** A message naming the keys the user must still give for these competitors, or null. */
export function missingKeysMessage(vendors: Vendor[], keys: UserKeys): string | null {
  const available = serverKeyVendors();
  const missing = [...new Set(vendors)].filter((v) => !keys[FIELD[v]] && !available.includes(v));
  if (!missing.length) return null;
  const names = missing.map((v) => KEY_NAMES[v]).join(" and ");
  return `Add your ${names} API key${missing.length > 1 ? "s" : ""} (Keys button): the agents run on your own accounts.`;
}

/** The key each agent will use: the user's, else the server's (locally only). */
export function resolveKeys(keys: UserKeys): { anthropic?: string; openai?: string } {
  return {
    anthropic: keys.anthropic ?? (useServerKeys ? SERVER_KEY.claude : undefined),
    openai: keys.openai ?? (useServerKeys ? SERVER_KEY.codex : undefined),
  };
}
