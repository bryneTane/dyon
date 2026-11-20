import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { competitorKey, competitorLabel, defaultCompetitors, isValidSpec, type Catalog } from "@/lib/domain/catalog";
import { claudeModelOptions, codexModelOptions } from "@/lib/server/catalog";

// Shaped like what the agents returned on 2026-11-20 (Claude Code `supportedModels()`, `codex debug models`),
// shortened to the fields Dyon reads.
const claudeModels: ModelInfo[] = [
  {
    value: "default",
    resolvedModel: "claude-opus-5-5",
    displayName: "Default (recommended)",
    description: "",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus",
    description: "",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-5-5",
    displayName: "Haiku",
    description: "",
    supportedEffortLevels: ["low", "medium", "high"],
  },
];
const level = (effort: string) => ({ effort, description: "" });
const codexJson = {
  models: [
    {
      slug: "gpt-6.2-astra",
      display_name: "GPT-6.2-Astra",
      visibility: "list",
      supported_in_api: true,
      priority: 2,
      supported_reasoning_levels: [level("low"), level("ultra")],
    },
    {
      slug: "gpt-6.2-sol",
      display_name: "GPT-6.2-Sol",
      visibility: "list",
      supported_in_api: true,
      priority: 1,
      supported_reasoning_levels: [level("low"), level("high")],
    },
    {
      slug: "codex-auto-review",
      display_name: "Codex Auto Review",
      visibility: "hide",
      supported_in_api: true,
      priority: 43,
      supported_reasoning_levels: [level("low")],
    },
  ],
};

describe("reading the agents' catalogs", () => {
  it("keeps each Claude model once, the agent's default first, under its specific name", () => {
    expect(claudeModelOptions(claudeModels)).toEqual([
      { id: "claude-opus-5-5", label: "Opus", efforts: ["low", "medium", "high", "xhigh", "max"] },
      { id: "claude-haiku-5-5", label: "Haiku", efforts: ["low", "medium", "high"] },
    ]);
  });

  it("keeps the Codex models offered to users, in Codex's own order", () => {
    expect(codexModelOptions(codexJson)).toEqual([
      { id: "gpt-6.2-sol", label: "GPT-6.2-Sol", efforts: ["low", "high"] },
      { id: "gpt-6.2-astra", label: "GPT-6.2-Astra", efforts: ["low", "ultra"] },
    ]);
  });

  it("refuses a Codex catalog whose shape changed", () => {
    expect(() => codexModelOptions({ models: [{ slug: "x" }] })).toThrow();
  });
});

const catalog: Catalog = {
  claude: { models: claudeModelOptions(claudeModels) },
  codex: { models: codexModelOptions(codexJson) },
};

describe("isValidSpec", () => {
  it("accepts a model the agent reported, with no effort or one that model accepts", () => {
    expect(isValidSpec({ vendor: "claude", model: "claude-haiku-5-5", effort: null }, catalog)).toBe(true);
    expect(isValidSpec({ vendor: "codex", model: "gpt-6.2-astra", effort: "ultra" }, catalog)).toBe(true);
  });

  it("refuses an effort the chosen model does not accept", () => {
    expect(isValidSpec({ vendor: "claude", model: "claude-haiku-5-5", effort: "max" }, catalog)).toBe(false);
    expect(isValidSpec({ vendor: "codex", model: "gpt-6.2-sol", effort: "ultra" }, catalog)).toBe(false);
  });

  it("refuses an unknown agent or model, a missing effort and values that are not objects", () => {
    expect(isValidSpec({ vendor: "gemini", model: "x", effort: null }, catalog)).toBe(false);
    expect(isValidSpec({ vendor: "claude", model: "gpt-6.2-sol", effort: null }, catalog)).toBe(false);
    expect(isValidSpec({ vendor: "claude", model: "claude-opus-5-5" }, catalog)).toBe(false);
    expect(isValidSpec(null, catalog)).toBe(false);
  });
});

describe("defaults, labels and keys", () => {
  it("starts with each agent's own default model and effort", () => {
    expect(defaultCompetitors(catalog)).toEqual([
      { vendor: "claude", model: "claude-opus-5-5", effort: null },
      { vendor: "codex", model: "gpt-6.2-sol", effort: null },
    ]);
  });

  it("leaves out an agent whose catalog could not be read", () => {
    expect(defaultCompetitors({ ...catalog, codex: { models: [], error: "x" } }).map((c) => c.vendor)).toEqual([
      "claude",
    ]);
  });

  it("names a competitor with its settings", () => {
    expect(competitorLabel({ vendor: "claude", model: "claude-opus-5-5", effort: "high" }, catalog)).toBe(
      "Claude Code · Opus · high effort",
    );
    expect(competitorKey({ vendor: "codex", model: "gpt-6.2-sol", effort: null })).toBe("codex|gpt-6.2-sol|default");
  });
});
