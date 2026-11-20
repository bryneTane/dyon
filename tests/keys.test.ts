import { describe, expect, it, vi } from "vitest";

// Read when the module loads: set before importing it.
vi.stubEnv("KEYS_SECRET", "test-secret");
vi.stubEnv("VERCEL", "1");

describe("visitor keys", async () => {
  const { decryptKeys, encryptKeys, missingKeysMessage, resolveKeys } = await import("@/lib/server/keys");

  it("round-trips through encryption, and the sealed form does not contain the key", () => {
    const sealed = encryptKeys({ anthropic: "sk-ant-secret" })!;
    expect(sealed).not.toContain("sk-ant-secret");
    expect(decryptKeys(sealed)).toEqual({ anthropic: "sk-ant-secret" });
  });

  it("stores nothing when no key is given", () => {
    expect(encryptKeys({})).toBeUndefined();
  });

  it("refuses a tampered sealed value", () => {
    const [iv, tag, data] = encryptKeys({ openai: "sk-1" })!.split(".");
    expect(() => decryptKeys([iv, tag, data.slice(0, -2) + "AA"].join("."))).toThrow();
  });

  it("hosted, requires the visitor's key for each agent and never falls back to the server's", () => {
    expect(missingKeysMessage(["claude", "codex"], { anthropic: "k" })).toBe(
      "Add your OpenAI API key (Keys button): the agents run on your own accounts.",
    );
    expect(missingKeysMessage(["claude"], { anthropic: "k" })).toBeNull();
    expect(resolveKeys({ anthropic: "k" })).toEqual({ anthropic: "k", openai: undefined });
  });
});
