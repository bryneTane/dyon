import { describe, expect, it } from "vitest";
import { createSchema, firstIssue, followUpSchema, verdictSchema } from "@/lib/domain/schemas";

const claude = { vendor: "claude", model: "m", effort: null };
const issue = (result: { success: boolean; error?: Parameters<typeof firstIssue>[0] }) =>
  result.success ? null : firstIssue(result.error!);

describe("createSchema", () => {
  it("fills the defaults and trims", () => {
    expect(createSchema.parse({ prompt: "  do it  ", competitors: [claude] })).toEqual({
      prompt: "do it",
      competitors: [claude],
      repeats: 1,
      check: null,
      blind: false,
      keys: {},
    });
  });

  it("turns an empty check into no check", () => {
    expect(createSchema.parse({ prompt: "x", competitors: [claude], check: "   " }).check).toBeNull();
    expect(createSchema.parse({ prompt: "x", competitors: [claude], check: " npm test " }).check).toBe("npm test");
  });

  it("refuses bad bodies with a readable first issue", () => {
    expect(issue(createSchema.safeParse({ prompt: " ", competitors: [claude] }))).toBe("prompt: Type a task first.");
    expect(issue(createSchema.safeParse({ prompt: "x", competitors: [] }))).toBe(
      "competitors: Pick at least one agent.",
    );
    expect(issue(createSchema.safeParse({ prompt: "x", competitors: [claude, claude, claude, claude] }))).toBe(
      "competitors: At most 3 competitors.",
    );
    expect(issue(createSchema.safeParse({ prompt: "x".repeat(20_001), competitors: [claude] }))).toBe(
      "prompt: A task is at most 20,000 characters.",
    );
    expect(createSchema.safeParse({ prompt: "x", competitors: [claude], repeats: 2 }).success).toBe(false);
    expect(createSchema.safeParse({ prompt: "x", competitors: [{ ...claude, vendor: "other" }] }).success).toBe(false);
  });

  it("refuses unknown fields", () => {
    expect(createSchema.safeParse({ prompt: "x", competitors: [claude], extra: 1 }).success).toBe(false);
    expect(createSchema.safeParse({ prompt: "x", competitors: [{ ...claude, extra: 1 }] }).success).toBe(false);
  });
});

describe("followUpSchema and verdictSchema", () => {
  it("parses valid bodies", () => {
    expect(followUpSchema.parse({ prompt: " more " })).toEqual({ prompt: "more", keys: {} });
    expect(followUpSchema.parse({ prompt: "x", keys: { openai: " sk-1 " } }).keys).toEqual({ openai: "sk-1" });
    expect(followUpSchema.safeParse({ prompt: "x", keys: { other: "k" } }).success).toBe(false);
    expect(verdictSchema.parse({ winner: "a" })).toEqual({ winner: "a", note: "" });
  });

  it("refuses bad ones", () => {
    expect(verdictSchema.safeParse({ winner: "" }).success).toBe(false);
    expect(verdictSchema.safeParse({ winner: "a", note: "x".repeat(2001) }).success).toBe(false);
  });
});
