import "server-only";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Where Dyon keeps its database. */
// Runtime data, not code: excluded from the build's file tracing.
export const dataDir = resolve(/*turbopackIgnore: true*/ process.env.DYON_DATA_DIR || join(process.cwd(), ".dyon"));

/** Postgres (hosted). Without it, a SQLite file in `dataDir`. */
export const databaseUrl = process.env.DATABASE_URL || null;

/** Where the web app reaches the worker, and the secret both share. Set by `npm run dev` locally. */
export const workerUrl = (process.env.WORKER_URL ?? "http://localhost:3001").replace(/\/$/, "");
export const workerSecret = process.env.WORKER_SECRET ?? "";

/** The live relay (party/), and the secret its tokens are signed with: held by the web app only. */
export const relayUrl = (process.env.RELAY_URL ?? "http://localhost:3002").replace(/\/$/, "");
export const relaySecret = process.env.RELAY_SECRET ?? "";

/**
 * One folder per comparison, one per run inside it. Outside the project on purpose: agents look for a git
 * repository and instruction files (AGENTS.md) in the folders above their own, and must find none.
 */
export const workDir = resolve(
  /*turbopackIgnore: true*/ process.env.DYON_WORK_DIR || join(realpathSync(tmpdir()), "dyon-work"),
);

/**
 * The installed Codex CLI package, where `npm install` puts it. Resolved from the project folder because the
 * bundler rewrites module resolution inside server code.
 */
export const codexPackageDir = join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "@openai", "codex");
