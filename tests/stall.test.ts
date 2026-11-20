import { describe, expect, it } from "vitest";
import { newRecord } from "@/lib/domain/record";
import { closeStalledTurn, NOT_STARTED, QUEUE_TIMEOUT_MS, STALL_MS, STALLED } from "@/lib/domain/stall";
import type { ComparisonInfo, ComparisonRecord, TurnState } from "@/lib/domain/types";

const info: ComparisonInfo = {
  id: "c",
  competitors: [{ vendor: "claude", model: "m", effort: null, id: "a", slot: 0 }],
  repeats: 1,
  check: null,
  blind: false,
  runs: [{ runId: "a-1", competitorId: "a", vendor: "claude", index: 1 }],
};
const T0 = Date.parse("2026-11-20T00:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();
const turn = (state: TurnState, heartbeatAt?: string): ComparisonRecord => {
  const r = newRecord(info, "do it", at(0));
  return { ...r, turns: r.turns.map((t) => ({ ...t, state, heartbeatAt })) };
};

describe("closeStalledTurn", () => {
  it("closes a running turn without a sign of life for too long", () => {
    const closed = closeStalledTurn(turn("running", at(1000)), T0 + 1000 + STALL_MS + 1)!;
    expect(closed.status).toBe("idle");
    expect(closed.turns[0]).toMatchObject({ state: "done", error: STALLED });
  });

  it("leaves a running turn with a recent sign of life", () => {
    expect(closeStalledTurn(turn("running", at(STALL_MS)), T0 + STALL_MS + 1000)).toBeNull();
  });

  it("closes a queued turn no worker started", () => {
    expect(closeStalledTurn(turn("queued"), T0 + QUEUE_TIMEOUT_MS + 1)?.turns[0].error).toBe(NOT_STARTED);
    expect(closeStalledTurn(turn("queued"), T0 + 1000)).toBeNull();
  });

  it("leaves an idle comparison", () => {
    const r = turn("done");
    expect(closeStalledTurn({ ...r, status: "idle" }, T0 + 10 * STALL_MS)).toBeNull();
  });
});
