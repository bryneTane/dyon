import { describe, expect, it } from "vitest";
import { competitorKey, competitorLabel, DEFAULT_COMPETITORS, isValidSpec, MODELS } from "@/lib/domain/catalog";

describe("isValidSpec", () => {
  it("accepts every catalog model with or without an effort", () => {
    for (const vendor of ["claude", "codex"] as const) {
      for (const { id } of MODELS[vendor]) {
        expect(isValidSpec({ vendor, model: id, effort: null })).toBe(true);
        expect(isValidSpec({ vendor, model: id, effort: "high" })).toBe(true);
      }
    }
  });

  it("refuses an unknown vendor, model or effort", () => {
    expect(isValidSpec({ vendor: "gemini", model: "x", effort: null })).toBe(false);
    expect(isValidSpec({ vendor: "claude", model: "gpt-6.2-sol", effort: null })).toBe(false);
    expect(isValidSpec({ vendor: "codex", model: MODELS.codex[0].id, effort: "maximum" })).toBe(false);
  });

  it("refuses a missing effort and values that are not objects", () => {
    expect(isValidSpec({ vendor: "claude", model: MODELS.claude[0].id })).toBe(false);
    expect(isValidSpec(null)).toBe(false);
    expect(isValidSpec("claude")).toBe(false);
  });

  it("starts with one valid competitor per agent", () => {
    expect(DEFAULT_COMPETITORS.map((c) => c.vendor)).toEqual(["claude", "codex"]);
    expect(DEFAULT_COMPETITORS.every(isValidSpec)).toBe(true);
  });
});

describe("labels and keys", () => {
  it("names a competitor with its settings", () => {
    expect(competitorLabel({ vendor: "claude", model: "claude-opus-5-5", effort: "high" })).toBe(
      "Claude Code · Opus 5.5 · high effort",
    );
    expect(competitorLabel({ vendor: "codex", model: "gpt-6.2-sol", effort: null })).toBe("Codex · GPT-6.2 Sol");
  });

  it("groups identical configurations under one key", () => {
    expect(competitorKey({ vendor: "codex", model: "gpt-6.2-sol", effort: null })).toBe("codex|gpt-6.2-sol|default");
  });
});

describe("efforts", () => {
  it("offers the levels both agents accept", () => {
    expect(isValidSpec({ vendor: "claude", model: MODELS.claude[0].id, effort: "max" })).toBe(true);
    expect(isValidSpec({ vendor: "codex", model: MODELS.codex[0].id, effort: "minimal" })).toBe(false);
  });
});
