import { gzipSync } from "node:zlib";
import { HttpError, isTransientHttp, withRetry } from "@/lib/domain/retry";
import type {
  BlobsRequest,
  BlobsResponse,
  ClaimResponse,
  ProgressRequest,
  ProgressResponse,
} from "@/lib/domain/worker-protocol";

/**
 * The worker's only way to the outside state: the web app's /api/worker/<id> routes, with a token for this
 * comparison. Database, storage and relay credentials stay in the web app; files go straight to storage through
 * short-lived links it signs. Every call retries transient failures (network, 429, 5xx) with backoff and jitter.
 */
export interface WorkerApi {
  claim(): Promise<ClaimResponse | null>;
  progress(body: ProgressRequest): Promise<ProgressResponse>;
  putBlob(key: string, data: Uint8Array, contentType: string): Promise<void>;
  getBlob(key: string): Promise<Buffer | null>;
}

const GZIP_ABOVE = 64 * 1024;

export function workerApi(baseUrl: string, comparisonId: string, token: string): WorkerApi {
  const base = `${baseUrl.replace(/\/$/, "")}/api/worker/${comparisonId}`;
  const retry = <T>(name: string, fn: () => Promise<T>) =>
    withRetry(fn, {
      transient: isTransientHttp,
      onRetry: (error, attempt, delayMs) =>
        console.warn(`${name}: retry ${attempt} in ${delayMs} ms:`, error instanceof Error ? error.message : error),
    });

  async function post<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
    const json = Buffer.from(JSON.stringify(body));
    const gzip = json.length > GZIP_ABOVE; // Vercel caps request bodies at 4.5 MB
    const response = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(gzip ? { "Content-Encoding": "gzip" } : {}),
      },
      body: gzip ? gzipSync(json) : json,
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok && response.status !== 409)
      throw new HttpError(`${path}: ${response.status} ${data.error ?? ""}`.trim(), response.status);
    return { status: response.status, data };
  }

  const blobUrls = async (request: BlobsRequest) => (await post<BlobsResponse>("blobs", request)).data;

  return {
    // A claim whose answer is lost cannot be retried into a second claim: the turn is already "running", so a
    // retry gets 409, and the stalled-turn check closes it after a minute without a sign of life.
    async claim() {
      const { status, data } = await retry("claim", () => post<ClaimResponse>("claim", {}));
      return status === 409 ? null : data;
    },
    async progress(body) {
      return (await retry("progress", () => post<ProgressResponse>("progress", body))).data;
    },
    async putBlob(key, data, contentType) {
      await retry("putBlob", async () => {
        const url = (await blobUrls({ put: [{ key, contentType }] })).put[key];
        const response = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: Buffer.from(data),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw new HttpError(`upload ${key}: ${response.status}`, response.status);
      });
    },
    async getBlob(key) {
      return retry("getBlob", async () => {
        const url = (await blobUrls({ get: [key] })).get[key];
        const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (response.status === 404) return null;
        if (!response.ok) throw new HttpError(`download ${key}: ${response.status}`, response.status);
        return Buffer.from(await response.arrayBuffer());
      });
    },
  };
}
