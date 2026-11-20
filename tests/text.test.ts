import { describe, expect, it } from "vitest";
import { clip, errorText, stringify } from "@/lib/domain/text";

describe("clip", () => {
  it("leaves short text untouched", () => {
    expect(clip("hello", 5)).toBe("hello");
  });

  it("keeps the start and says how much was cut", () => {
    expect(clip("abcdefghij", 4)).toBe("abcd\n[6 characters omitted]");
  });

  it("keeps the end when asked", () => {
    expect(clip("abcdefghij", 3, "end")).toBe("[7 characters omitted]\nhij");
  });

  it("formats large counts with separators", () => {
    expect(clip("x".repeat(1_234_005), 5)).toContain("[1,234,000 characters omitted]");
  });
});

describe("stringify", () => {
  it("returns strings as they are", () => {
    expect(stringify("plain")).toBe("plain");
  });

  it("serializes objects as JSON", () => {
    expect(stringify({ a: 1 })).toBe('{"a":1}');
  });

  it("falls back to String for values JSON cannot represent", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(stringify(circular)).toBe("[object Object]");
    expect(stringify(undefined)).toBe("undefined");
  });
});

describe("errorText", () => {
  it("uses the message of an Error", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
  });

  it("describes anything else that was thrown", () => {
    expect(errorText("plain failure")).toBe("plain failure");
    expect(errorText({ code: 42 })).toBe('{"code":42}');
  });
});
