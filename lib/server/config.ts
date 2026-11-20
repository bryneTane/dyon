import "server-only";
import { join, resolve } from "node:path";

/** Where Dyon keeps its database and the agents' workspaces. */
export const dataDir = resolve(process.env.DYON_DATA_DIR || join(process.cwd(), ".dyon"));

/** One folder per comparison, one per run inside it. */
export const workDir = join(dataDir, "work");
