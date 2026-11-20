import "server-only";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

/** One run's folders: the agent works in `dir`, with its own home and temporary folder. */
export interface Workspace {
  root: string;
  dir: string;
  /** Resolved path of `dir` (macOS reports /private/var for /var), to recognize it in agent output. */
  dirReal: string;
  home: string;
  tmp: string;
}

async function workspaceAt(root: string): Promise<Workspace> {
  const dir = join(root, "workspace");
  const home = join(root, "home");
  return { root, dir, dirReal: await realpath(dir), home, tmp: join(home, "tmp") };
}

/** Creates an empty workspace under `root`, with the run's home and temporary folder. */
export async function createWorkspace(root: string): Promise<Workspace> {
  await mkdir(join(root, "workspace"), { recursive: true });
  await mkdir(join(root, "home", "tmp"), { recursive: true });
  return workspaceAt(root);
}

/** Reopens a workspace created earlier, for the next turn. */
export function openWorkspace(root: string): Promise<Workspace> {
  return workspaceAt(root);
}

/** Paths relative to the workspace, so both agents' paths read the same way. */
export function relativePath(ws: Workspace, path: string): string {
  for (const base of [ws.dirReal, ws.dir]) {
    if (path === base) return ".";
    if (path.startsWith(`${base}/`)) return path.slice(base.length + 1);
  }
  return path;
}

/**
 * Environment for an agent and the commands it runs: nothing from Dyon's own environment
 * except PATH, so its keys and settings never leak. `extra` adds what one agent needs (its key).
 */
export function agentEnv(ws: Workspace, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: ws.home,
    TMPDIR: ws.tmp,
    LANG: "C.UTF-8",
    ...extra,
  };
}
