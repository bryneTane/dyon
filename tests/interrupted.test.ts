import { describe, expect, it } from "vitest";
import { closeInterruptedTurn, INTERRUPTED } from "@/lib/domain/interrupted";
import { newRecord } from "@/lib/domain/record";
import type { ComparisonInfo, ComparisonRecord } from "@/lib/domain/types";

const info: ComparisonInfo = {
  id: "c",
  competitors: [{ vendor: "claude", model: "m", effort: null, id: "a", slot: 0 }],
  repeats: 1,
  check: null,
  blind: false,
  runs: [{ runId: "a-1", competitorId: "a", vendor: "claude", index: 1 }],
};
const running = (bootId: string | null): ComparisonRecord => {
  const r = newRecord(info, "do it", "2026-11-20T00:00:00.000Z");
  return { ...r, turns: r.turns.map((t) => ({ ...t, state: "running", bootId })) };
};

describe("closeInterruptedTurn", () => {
  it("closes a turn started by another server process", () => {
    const closed = closeInterruptedTurn(running("old"), "now")!;
    expect(closed.status).toBe("idle");
    expect(closed.turns[0]).toMatchObject({ state: "done", error: INTERRUPTED });
  });

  it("closes a queued turn that no process took", () => {
    const r = newRecord(info, "do it", "2026-11-20T00:00:00.000Z");
    expect(closeInterruptedTurn(r, "now")?.turns[0].state).toBe("done");
  });

  it("leaves a turn this process is running", () => {
    expect(closeInterruptedTurn(running("now"), "now")).toBeNull();
  });

  it("leaves an idle comparison", () => {
    const r = running("old");
    const idle: ComparisonRecord = { ...r, status: "idle", turns: r.turns.map((t) => ({ ...t, state: "done" })) };
    expect(closeInterruptedTurn(idle, "now")).toBeNull();
  });
});
