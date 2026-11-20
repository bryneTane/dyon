// What can be compared: the agents, their models and their reasoning effort.

export const VENDORS = ["claude", "codex"] as const;
export type Vendor = (typeof VENDORS)[number];

export const VENDOR_LABELS: Record<Vendor, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

export interface ModelOption {
  id: string;
  label: string;
}

/** Models offered per agent. The first one is the default. */
export const MODELS: Record<Vendor, ModelOption[]> = {
  claude: [
    { id: "claude-opus-5-5", label: "Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
    { id: "claude-haiku-5-5", label: "Haiku 5.5" },
    { id: "claude-fable-5-2", label: "Fable 5.2" },
  ],
  codex: [
    { id: "gpt-6.2-sol", label: "GPT-6.2 Sol" },
    { id: "gpt-6.2-astra", label: "GPT-6.2 Astra" },
    { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
    { id: "gpt-6-luna", label: "GPT-6 Luna" },
  ],
};

/**
 * Reasoning effort levels both agents accept (each also has levels the other lacks).
 * Null means the agent's own default. Not every model supports every level: the agent's error is shown as is.
 */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export const MAX_COMPETITORS = 3;

/** What the user picks for one competitor. */
export interface CompetitorSpec {
  vendor: Vendor;
  model: string;
  effort: Effort | null;
}

/** A competitor inside a comparison: `id` is a letter (a, b, c), `slot` fixes its color. */
export interface Competitor extends CompetitorSpec {
  id: string;
  slot: number;
}

export const DEFAULT_COMPETITORS: CompetitorSpec[] = [
  { vendor: "claude", model: MODELS.claude[0].id, effort: null },
  { vendor: "codex", model: MODELS.codex[0].id, effort: null },
];

export function isValidSpec(value: unknown): value is CompetitorSpec {
  if (typeof value !== "object" || value === null) return false;
  const spec = value as Partial<CompetitorSpec>;
  return (
    VENDORS.includes(spec.vendor as Vendor) &&
    MODELS[spec.vendor as Vendor].some((m) => m.id === spec.model) &&
    (spec.effort === null || EFFORTS.includes(spec.effort as Effort))
  );
}

export function modelLabel(vendor: Vendor, model: string): string {
  return MODELS[vendor].find((m) => m.id === model)?.label ?? model;
}

/** "Opus 5.5 · high effort" */
export function settingsLabel(spec: CompetitorSpec): string {
  return `${modelLabel(spec.vendor, spec.model)}${spec.effort ? ` · ${spec.effort} effort` : ""}`;
}

/** "Claude Code · Opus 5.5 · high effort" */
export function competitorLabel(spec: CompetitorSpec): string {
  return `${VENDOR_LABELS[spec.vendor]} · ${settingsLabel(spec)}`;
}

/** Groups identical configurations across comparisons. */
export function competitorKey(spec: CompetitorSpec): string {
  return `${spec.vendor}|${spec.model}|${spec.effort ?? "default"}`;
}
