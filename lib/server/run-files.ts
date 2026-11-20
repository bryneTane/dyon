import "server-only";
import { unzipSync } from "fflate";
import type { WorkspaceFile } from "@/lib/domain/types";
import { blobs } from "./blobs";
import { isId } from "./ids";
import { store } from "./store";
import { snapshotKeys } from "./workspace";

/** Where a run's latest saved files are (written by the worker after each turn). */
export async function runSnapshot(
  comparisonId: string,
  runId: string,
): Promise<{ list: string; zip: string; turn: number } | { error: string; status: number }> {
  const record = isId(comparisonId) ? await (await store()).get(comparisonId) : null;
  const run = record?.runs[runId];
  if (!record || !record.info.runs.some((r) => r.runId === runId))
    return { error: "This run does not exist.", status: 404 };
  if (!run?.archive) return { error: "No files saved yet.", status: 404 };
  return { ...snapshotKeys(run.archive.key), turn: run.archive.turn };
}

export async function readList(key: string): Promise<WorkspaceFile[] | null> {
  const data = await (await blobs()).get(key);
  return data ? (JSON.parse(data.toString("utf8")) as WorkspaceFile[]) : null;
}

// Zips never change (one per saved turn): the last few are kept in memory between requests.
const zips = new Map<string, Uint8Array>();
const ZIP_CACHE = 4;

export async function readZip(key: string): Promise<Uint8Array | null> {
  const cached = zips.get(key);
  if (cached) return cached;
  const data = await (await blobs()).get(key);
  if (!data) return null;
  const bytes = new Uint8Array(data);
  zips.set(key, bytes);
  if (zips.size > ZIP_CACHE) zips.delete(zips.keys().next().value!);
  return bytes;
}

/** One file out of the run's zip; null if absent. Paths are matched exactly against the zip entries. */
export async function readZipEntry(key: string, path: string): Promise<Uint8Array | null> {
  const zip = await readZip(key);
  if (!zip) return null;
  return unzipSync(zip, { filter: (entry) => entry.name === path })[path] ?? null;
}
