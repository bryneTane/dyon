import "server-only";
import { execFile } from "node:child_process";
import { mkdir, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";
import { join } from "node:path";
import { promisify } from "node:util";
import { clip } from "@/lib/domain/text";
import type { CheckResult, DiffFile, FileContent, RunTurnResult, WorkspaceFile } from "@/lib/domain/types";

const exec = promisify(execFile);
// Dyon's own git calls: a fixed identity, and no hooks or settings the agent could have written.
const GIT = ["-c", "user.name=dyon", "-c", "user.email=dyon@example.invalid", "-c", "core.hooksPath=/dev/null"];
const MAX_PATCH_CHARS = 200_000;

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

/**
 * Creates an empty workspace under `root`, with the run's home and temporary folder. The workspace is a git
 * repository with an empty first commit, as a real project would be.
 */
export async function createWorkspace(root: string): Promise<Workspace> {
  const dir = join(root, "workspace");
  await mkdir(dir, { recursive: true });
  await mkdir(join(root, "home", "tmp"), { recursive: true });
  await exec("git", [...GIT, "init", "-q"], { cwd: dir });
  // Dependency folders stay out of the diff, through a file of git's own that the agent does not see.
  await writeFile(join(dir, ".git", "info", "exclude"), "node_modules/\n.venv/\n__pycache__/\n");
  await exec("git", [...GIT, "commit", "-q", "--allow-empty", "-m", "Start"], { cwd: dir });
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

/** Stages the whole workspace in Dyon's own index, so the agent's `git status` and staging area stay untouched. */
async function stageAll(ws: Workspace) {
  const index = join(ws.root, "dyon-index");
  const options = { cwd: ws.dir, maxBuffer: 50 * 1024 * 1024, env: { ...process.env, GIT_INDEX_FILE: index } };
  await rm(index, { force: true });
  await exec("git", [...GIT, "add", "-A"], options);
  return { options, done: () => rm(index, { force: true }) };
}

/** Records the workspace as it is at the start of a turn (a git tree, kept outside the workspace). */
export async function markTurnStart(ws: Workspace): Promise<void> {
  const { options, done } = await stageAll(ws);
  try {
    const { stdout } = await exec("git", [...GIT, "write-tree"], options);
    await writeFile(join(ws.root, "turn-start"), stdout.trim());
  } finally {
    await done();
  }
}

/** Every change in the workspace since the start of the turn, committed by the agent or not. */
export async function workspaceDiff(ws: Workspace): Promise<NonNullable<RunTurnResult["diff"]>> {
  const start = (await readFile(join(ws.root, "turn-start"), "utf8")).trim();
  const { options, done } = await stageAll(ws);
  try {
    const diff = (...args: string[]) =>
      exec("git", [...GIT, "diff", "--cached", "--no-renames", ...args, start], options);
    const [status, numstat, patch] = await Promise.all([
      diff("--name-status", "-z"),
      diff("--numstat", "-z"),
      diff("--no-color"),
    ]);
    const lines = new Map<string, [number | null, number | null]>();
    for (const entry of numstat.stdout.split("\0").filter(Boolean)) {
      const [added, removed, path] = entry.split("\t");
      lines.set(path, [added === "-" ? null : Number(added), removed === "-" ? null : Number(removed)]);
    }
    const files: DiffFile[] = [];
    const parts = status.stdout.split("\0").filter(Boolean);
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const path = parts[i + 1];
      const [added, removed] = lines.get(path) ?? [null, null];
      const change = parts[i] === "A" ? "added" : parts[i] === "D" ? "deleted" : "modified";
      files.push({ path, change, added, removed });
    }
    return { files, patch: patch.stdout.slice(0, MAX_PATCH_CHARS), truncated: patch.stdout.length > MAX_PATCH_CHARS };
  } finally {
    await done();
  }
}

const MAX_FILE_BYTES = 256 * 1024;
const MAX_ZIP_BYTES = 100 * 1024 * 1024;

/** Files in the workspace now (dependency folders excluded), each marked if the latest turn changed it. */
export async function listFiles(ws: Workspace): Promise<WorkspaceFile[]> {
  const { stdout } = await exec("git", [...GIT, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: ws.dir,
    maxBuffer: 20 * 1024 * 1024,
  });
  const changed = new Map((await workspaceDiff(ws).catch(() => null))?.files.map((f) => [f.path, f]) ?? []);
  const paths = [...new Set(stdout.split("\0").filter(Boolean))].sort();
  const files = await Promise.all(
    paths.map(async (path): Promise<WorkspaceFile | null> => {
      // Same rule as reading: a link that leads outside the workspace is not listed.
      const resolved = await resolveInside(ws, path).catch(() => null);
      if (!resolved) return null;
      const info = await stat(resolved);
      const diff = changed.get(path);
      const change = diff && diff.change !== "deleted" ? diff.change : null;
      return { path, size: info.size, change, added: diff?.added ?? null, removed: diff?.removed ?? null };
    }),
  );
  return files.filter((f): f is WorkspaceFile => f !== null);
}

/** Absolute path of a workspace file, or null if it resolves outside the workspace (`..`, symlinks) or is not a file. */
async function resolveInside(ws: Workspace, path: string): Promise<string | null> {
  const resolved = await realpath(join(ws.dir, path)).catch(() => null);
  if (!resolved || !resolved.startsWith(`${ws.dirReal}/`)) return null;
  return (await stat(resolved)).isFile() ? resolved : null;
}

export async function readRawFile(ws: Workspace, path: string): Promise<Buffer | null> {
  const resolved = await resolveInside(ws, path);
  return resolved ? readFile(resolved) : null;
}

/** Reads one file for display (first 256 KB), refusing any path outside the workspace. */
export async function readWorkspaceFile(ws: Workspace, path: string): Promise<FileContent | null> {
  const resolved = await resolveInside(ws, path);
  if (!resolved) return null;
  const info = await stat(resolved);
  const handle = await open(resolved, "r");
  try {
    const buffer = Buffer.alloc(Math.min(info.size, MAX_FILE_BYTES));
    await handle.read(buffer, 0, buffer.length, 0);
    if (buffer.subarray(0, 8000).includes(0)) return { kind: "binary", path, size: info.size };
    return {
      kind: "text",
      path,
      size: info.size,
      text: buffer.toString("utf8"),
      truncated: info.size > MAX_FILE_BYTES,
    };
  } finally {
    await handle.close();
  }
}

/** The listed files as a zip archive, up to 100 MB. */
export async function zipWorkspace(ws: Workspace): Promise<Uint8Array> {
  const files = await listFiles(ws);
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_ZIP_BYTES)
    throw new Error(`Workspace too large to zip (${Math.round(total / 1024 / 1024)} MB, limit 100 MB).`);
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    const raw = await readRawFile(ws, file.path);
    if (raw) entries[file.path] = new Uint8Array(raw);
  }
  return zipSync(entries, { level: 6 });
}

/**
 * Runs the user's check command in the workspace, with the agents' minimal environment. Exit code 0 means
 * passed. The output keeps its end, where test runners print their summary.
 */
export async function runCheck(
  ws: Workspace,
  command: string,
  signal: AbortSignal,
  timeoutMs = 120_000,
): Promise<CheckResult> {
  const started = performance.now();
  const result = (passed: boolean, exitCode: number | null, timedOut: boolean, output: string): CheckResult => ({
    command,
    passed,
    exitCode,
    timedOut,
    durationMs: Math.round(performance.now() - started),
    output: clip(output.trim(), 4000, "end"),
  });
  try {
    const { stdout, stderr } = await exec("bash", ["-c", command], {
      cwd: ws.dir,
      env: agentEnv(ws) as NodeJS.ProcessEnv,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 5 * 1024 * 1024,
      signal,
    });
    return result(true, 0, false, stdout + stderr);
  } catch (error) {
    const e = error as { code?: unknown; killed?: boolean; stdout?: string; stderr?: string; message?: string };
    const timedOut = Boolean(e.killed) && !signal.aborted;
    const output = `${e.stdout ?? ""}${e.stderr ?? ""}` || (e.message ?? "");
    return result(false, typeof e.code === "number" ? e.code : null, timedOut, output);
  }
}
