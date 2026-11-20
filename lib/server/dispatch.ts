import "server-only";
import { HttpError, isTransientHttp, withRetry } from "@/lib/domain/retry";
import { cloudRun, googleCredentials, workerSecret, workerUrl } from "./config";
import { CATALOG_SUBJECT, signWorkerToken } from "./worker-auth";

/**
 * Starts a worker, handing it a token for one comparison (or for reporting the models) only.
 * Locally: POST the worker process, which answers 202 and runs the turn.
 * Hosted (CLOUD_RUN_JOB): one Cloud Run Job execution per turn, with the comparison id and token in its
 * environment; the process lives exactly as long as the turn, so it cannot be reclaimed mid-run.
 *
 * Transient failures are retried with backoff and jitter. A retry after a lost response may start a second
 * worker: harmless, because only one can claim the queued turn (the other finds nothing to do).
 */
const TIMEOUT_MS = 15_000;

/** gRPC codes worth retrying: DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, ABORTED, INTERNAL, UNAVAILABLE. */
const TRANSIENT_GRPC = new Set([4, 8, 10, 13, 14]);
const transient = (error: unknown) =>
  TRANSIENT_GRPC.has((error as { code?: number })?.code ?? -1) || isTransientHttp(error);
const onRetry = (error: unknown, attempt: number, delayMs: number) =>
  console.warn(`Dispatch retry ${attempt} in ${delayMs} ms:`, error instanceof Error ? error.message : error);

/** Starts a worker on a comparison's queued turn. */
export function dispatchTurn(comparisonId: string): Promise<void> {
  return dispatch("/run", [{ name: "COMPARISON_ID", value: comparisonId }], signWorkerToken(comparisonId));
}

/** Starts a worker that reads both agents' models and reports them (the web app cannot run the agents). */
export function dispatchCatalog(): Promise<void> {
  return dispatch("/catalog", [{ name: "DYON_MODE", value: "catalog" }], signWorkerToken(CATALOG_SUBJECT));
}

async function dispatch(path: string, vars: { name: string; value: string }[], token: string): Promise<void> {
  const run = cloudRun;
  if (run) {
    const { JobsClient } = await import("@google-cloud/run");
    const credentials = googleCredentials();
    // Job executions go through the regional endpoint.
    const client = new JobsClient({
      apiEndpoint: `${run.region}-run.googleapis.com`,
      ...(credentials ? { credentials } : {}),
    });
    const env = [...vars, { name: "WORKER_TOKEN", value: token }];
    await withRetry(
      () =>
        client.runJob(
          {
            name: `projects/${run.project}/locations/${run.region}/jobs/${run.job}`,
            overrides: { containerOverrides: [{ env }] },
          },
          { timeout: TIMEOUT_MS },
        ),
      { transient, onRetry },
    );
    return;
  }
  await withRetry(
    async () => {
      const response = await fetch(`${workerUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${workerSecret}` },
        body: JSON.stringify({ ...Object.fromEntries(vars.map((v) => [v.name, v.value])), token }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new HttpError(`The worker answered ${response.status}.`, response.status);
    },
    { transient, onRetry },
  );
}
