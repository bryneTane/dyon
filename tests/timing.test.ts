import { describe, expect, it } from "vitest";
import { createStepClock } from "@/lib/domain/timing";

describe("createStepClock", () => {
  it("keeps the first time a step was seen and adds when it stopped running", () => {
    let clock = 1000;
    const stamp = createStepClock(() => clock);
    clock = 1200;
    expect(stamp({ id: "c", kind: "command", command: "ls", status: "running" })).toMatchObject({ t: 200 });
    clock = 1700;
    const done = stamp({ id: "c", kind: "command", command: "ls", status: "ok" });
    expect(done).toMatchObject({ t: 200, endT: 700 });
  });

  it("gives a step that never ran no end time", () => {
    let clock = 0;
    const stamp = createStepClock(() => clock);
    clock = 50;
    expect(stamp({ id: "m", kind: "message", text: "hi" })).toEqual({ id: "m", kind: "message", text: "hi", t: 50 });
  });
});
