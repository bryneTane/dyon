/**
 * Retry with capped exponential backoff and full jitter, for calls that are safe to repeat.
 * Jitter spreads the retries of many clients so they do not hit a recovering service in sync
 * (Google SRE, "How to avoid a self-inflicted DDoS"). Only errors marked transient are retried.
 */
export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  /** Decides whether an error is worth another attempt. */
  transient: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const { attempts = 4, baseMs = 300, maxMs = 5_000, transient, onRetry } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= attempts || !transient(error)) throw error;
      const delayMs = Math.round(random() * Math.min(maxMs, baseMs * 2 ** (attempt - 1)));
      onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
}

/** An HTTP failure with its status, so callers can tell transient (429, 5xx) from permanent (4xx). */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Network failures, timeouts, 408, 429 and 5xx are transient; other HTTP errors are not. */
export function isTransientHttp(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 408 || error.status === 429 || error.status >= 500;
  const name = (error as { name?: string })?.name;
  return name === "TypeError" || name === "TimeoutError" || name === "AbortError"; // fetch: network error, timeout
}
