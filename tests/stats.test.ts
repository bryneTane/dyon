import { describe, expect, it } from "vitest";
import { median, range, wilson } from "@/lib/domain/stats";

describe("stats", () => {
  it("median of odd and even counts, null when empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("range", () => {
    expect(range([5, 2, 9])).toEqual([2, 9]);
    expect(range([])).toBeNull();
  });

  it("Wilson interval", () => {
    // 5 out of 10 at 95%: 0.2366 to 0.7634 (standard tables).
    const [low, high] = wilson(5, 10);
    expect(low).toBeCloseTo(0.2366, 3);
    expect(high).toBeCloseTo(0.7634, 3);
    expect(wilson(0, 0)).toEqual([0, 1]);
    expect(wilson(3, 3)[1]).toBe(1);
  });
});
