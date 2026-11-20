import { z } from "zod";
import type { ComparisonRecord, HistoryEntry } from "./types";

/**
 * The contract between the worker and the web app (app/api/worker/[id]/*). The worker owns no credentials: it
 * authenticates with a token for one comparison and does everything through these calls.
 */

/** POST claim: take the queued turn. 409 when there is none (another worker took it, or it was closed). */
export interface ClaimResponse {
  record: ComparisonRecord;
  turnIndex: number;
  /** Fencing token: progress is refused once the turn was closed or claimed by someone else. */
  claim: string;
  /** The API keys the agents use for this turn. */
  keys: { anthropic?: string; openai?: string };
  /** The comparison's live room, and a token to publish to it. */
  room: { url: string; token: string };
}

/**
 * POST progress: saves what changed since the last call (the items of the runs that changed), and serves as the
 * heartbeat. The answer carries the stop request, so the worker needs no other poll. The final call closes the
 * turn and records the runs' results for the scoreboard, once: a repeated final call finds the turn closed.
 */
export const progressRequestSchema = z.object({
  claim: z.uuid(),
  turnIndex: z.number().int().min(0),
  seq: z.number().int().min(0),
  final: z.boolean(),
  items: z.record(z.string(), z.array(z.any())),
  results: z.record(z.string(), z.any()),
  error: z.string().max(5000).optional(),
  runs: z.record(z.string(), z.any()),
  history: z.array(z.any()).max(20).default([]),
});
export type ProgressRequest = z.input<typeof progressRequestSchema> & { history?: HistoryEntry[] };
export interface ProgressResponse {
  stopRequested: boolean;
  /** The turn is no longer this worker's (closed as stalled): stop and write nothing more. */
  claimLost: boolean;
}

/** POST blobs: short-lived links to upload or read run files under runs/<comparisonId>/. */
export const blobsRequestSchema = z.object({
  put: z
    .array(z.object({ key: z.string().max(300), contentType: z.string().max(100) }))
    .max(10)
    .default([]),
  get: z.array(z.string().max(300)).max(10).default([]),
});
export type BlobsRequest = z.input<typeof blobsRequestSchema>;
export interface BlobsResponse {
  put: Record<string, string>;
  get: Record<string, string>;
}
