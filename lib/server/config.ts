import "server-only";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Where Dyon keeps its database. */
// Runtime data, not code: excluded from the build's file tracing.
export const dataDir = resolve(/*turbopackIgnore: true*/ process.env.DYON_DATA_DIR || join(process.cwd(), ".dyon"));

/** Postgres (hosted). Without it, a SQLite file in `dataDir`. */
export const databaseUrl = process.env.DATABASE_URL || null;

/**
 * The secret worker tokens are signed with (web app only), and, locally, the worker process the web app hands
 * turns to. Hosted, each turn is a Cloud Run Job execution instead (CLOUD_RUN_JOB). Set by `npm run dev` locally.
 */
export const workerSecret = process.env.WORKER_SECRET ?? "";
export const workerUrl = (process.env.WORKER_URL ?? "http://localhost:3001").replace(/\/$/, "");
export const cloudRun = process.env.CLOUD_RUN_JOB
  ? { job: process.env.CLOUD_RUN_JOB, project: process.env.GCP_PROJECT_ID ?? "", region: process.env.GCP_REGION ?? "" }
  : null;

/**
 * Hosted, every turn runs on the visitor's own keys; the server's keys (.env.local) are used for turns only
 * locally. KEYS_SECRET encrypts the visitor's keys while a turn waits for a worker.
 */
export const useServerKeys = !process.env.VERCEL;
export const keysSecret = process.env.KEYS_SECRET ?? "";

/** Where run files are kept: a Google Cloud Storage bucket when set, else a folder in `dataDir`. */
export const blobBucket = process.env.BLOB_BUCKET || null;

/** The web app's service account key (JSON), for Cloud Run and Cloud Storage. Unset: the machine's own credentials. */
export function googleCredentials(): { client_email: string; private_key: string } | undefined {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  return raw ? JSON.parse(raw) : undefined;
}

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
