import "server-only";
import { join, resolve } from "node:path";

/** Where Dyon keeps its database and the agents' workspaces. */
// Runtime data, not code: excluded from the build's file tracing.
export const dataDir = resolve(/*turbopackIgnore: true*/ process.env.DYON_DATA_DIR || join(process.cwd(), ".dyon"));

/** One folder per comparison, one per run inside it. */
export const workDir = join(dataDir, "work");
