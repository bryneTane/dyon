import { describe, expect, it } from "vitest";
import { applyEvent, followEvent, newRecord } from "@/lib/domain/record";
import type { ComparisonInfo, StreamEvent } from "@/lib/domain/types";

const info: ComparisonInfo = {
  id: "c",
  competitors: [{ vendor: "claude", model: "m", effort: null, id: "a", slot: 0 }],
  repeats: 1,
  check: null,
  blind: false,
  runs: [{ runId: "a-1", competitorId: "a", vendor: "claude", index: 1 }],
};
const start = () => newRecord(info, "do it", "2026-11-20T00:00:00.000Z");
const apply = (...events: StreamEvent[]) => events.reduce(applyEvent, start());

describe("applyEvent", () => {
  it("starts with the first turn queued and the comparison busy", () => {
    expect(start().turns[0].state).toBe("queued");
    expect(start().status).toBe("busy");
    expect(Object.keys(start().runs)).toEqual(["a-1"]);
  });

  it("adds steps, and replaces a step sent again under the same id", () => {
    const r = apply(
      { type: "turn_start", turnIndex: 0, prompt: "do it" },
      {
        type: "item",
        runId: "a-1",
        turnIndex: 0,
        item: { id: "1", kind: "command", command: "ls", status: "running" },
      },
      { type: "item", runId: "a-1", turnIndex: 0, item: { id: "2", kind: "message", text: "hi" } },
      { type: "item", runId: "a-1", turnIndex: 0, item: { id: "1", kind: "command", command: "ls", status: "ok" } },
    );
    expect(r.turns[0].state).toBe("running");
    expect(r.turns[0].items["a-1"].map((i) => `${i.id}:${i.status ?? ""}`)).toEqual(["1:ok", "2:"]);
  });

  it("records how runs ended, what the agent reported, and ends the turn", () => {
    const r = apply(
      { type: "run_meta", runId: "a-1", model: "claude-x", version: "1.0" },
      { type: "run_end", runId: "a-1", turnIndex: 0, outcome: { status: "completed" }, wallMs: 1200 },
      { type: "turn_done", turnIndex: 0 },
    );
    expect(r.meta["a-1"]).toEqual({ model: "claude-x", version: "1.0" });
    expect(r.turns[0].ends["a-1"]).toEqual({ outcome: { status: "completed" }, wallMs: 1200 });
    expect(r.turns[0].state).toBe("done");
    expect(r.status).toBe("idle");
  });

  it("keeps a turn-level error on the current turn", () => {
    expect(apply({ type: "fatal", message: "Codex: no key." }).turns[0].error).toBe("Codex: no key.");
  });
});

describe("followEvent", () => {
  const event: StreamEvent = { type: "turn_start", turnIndex: 0, prompt: "do it" };

  it("applies the next event and moves seq", () => {
    const { record, gap } = followEvent(start(), { seq: 1, event });
    expect(gap).toBe(false);
    expect(record.seq).toBe(1);
    expect(record.turns[0].state).toBe("running");
  });

  it("ignores an event already in the record", () => {
    const saved = { ...start(), seq: 5 };
    expect(followEvent(saved, { seq: 4, event })).toEqual({ record: saved, gap: false });
  });

  it("reports a gap when events were missed", () => {
    expect(followEvent(start(), { seq: 3, event }).gap).toBe(true);
  });
});
