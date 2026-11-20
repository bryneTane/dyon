import { describe, expect, it } from "vitest";
import { HttpError, isTransientHttp, withRetry } from "@/lib/domain/retry";

const noSleep = { sleep: async () => {}, random: () => 1 };

describe("withRetry", () => {
  it("retries transient failures, then succeeds", async () => {
    let calls = 0;
    const delays: number[] = [];
    const value = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new HttpError("busy", 503);
        return "ok";
      },
      { transient: isTransientHttp, onRetry: (_e, _a, d) => delays.push(d), ...noSleep },
    );
    expect(value).toBe("ok");
    expect(calls).toBe(3);
    expect(delays).toEqual([300, 600]); // exponential, random() = 1 gives the cap of each step
  });
  it("does not retry permanent failures", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => (calls++, Promise.reject(new HttpError("bad", 400))), {
        transient: isTransientHttp,
        ...noSleep,
      }),
    ).rejects.toThrow("bad");
    expect(calls).toBe(1);
  });
  it("gives up after the attempt limit", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => (calls++, Promise.reject(new HttpError("down", 500))), {
        transient: isTransientHttp,
        attempts: 4,
        ...noSleep,
      }),
    ).rejects.toThrow("down");
    expect(calls).toBe(4);
  });
  it("caps the delay and spreads it with jitter", async () => {
    const delays: number[] = [];
    await withRetry(async () => Promise.reject(new HttpError("x", 500)), {
      transient: () => true,
      attempts: 8,
      maxMs: 1000,
      onRetry: (_e, _a, d) => delays.push(d),
      sleep: async () => {},
      random: () => 0.5,
    }).catch(() => {});
    expect(Math.max(...delays)).toBeLessThanOrEqual(500);
  });
  it("classifies errors", () => {
    expect(isTransientHttp(new HttpError("", 429))).toBe(true);
    expect(isTransientHttp(new HttpError("", 404))).toBe(false);
    expect(isTransientHttp(Object.assign(new Error("fetch failed"), { name: "TypeError" }))).toBe(true);
  });
});
