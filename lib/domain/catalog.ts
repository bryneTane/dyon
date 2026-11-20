// What can be compared. The agents are Dyon's choice; their models and effort levels come from the agents
// themselves at runtime (lib/server/catalog.ts), never from a list written here.

export const VENDORS = ["claude", "codex"] as const;
export type Vendor = (typeof VENDORS)[number];

export const VENDOR_LABELS: Record<Vendor, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

export const MAX_COMPETITORS = 3;

export interface ModelOption {
  /** The id passed to the agent. */
  id: string;
  label: string;
  /** Effort levels this model accepts, as the agent names them. */
  efforts: string[];
}

/** Models per agent as the agent reports them, the agent's default first. `error` when it could not be read. */
export type Catalog = Record<Vendor, { models: ModelOption[]; error?: string }>;

/** What the user picks for one competitor. `effort: null` leaves the agent's own default. */
export interface CompetitorSpec {
  vendor: Vendor;
  model: string;
  effort: string | null;
}

/** A competitor inside a comparison: `id` is a letter (a, b, c), `slot` fixes its color. */
export interface Competitor extends CompetitorSpec {
  id: string;
  slot: number;
}

export function findModel(catalog: Catalog, vendor: Vendor, model: string): ModelOption | undefined {
  return catalog[vendor]?.models.find((m) => m.id === model);
}

/** A known agent, one of its models, and an effort level that model accepts (or none). */
export function isValidSpec(value: unknown, catalog: Catalog): value is CompetitorSpec {
  if (typeof value !== "object" || value === null) return false;
  const spec = value as Partial<CompetitorSpec>;
  if (!VENDORS.includes(spec.vendor as Vendor) || typeof spec.model !== "string") return false;
  const model = findModel(catalog, spec.vendor as Vendor, spec.model);
  return (
    model !== undefined &&
    (spec.effort === null || (typeof spec.effort === "string" && model.efforts.includes(spec.effort)))
  );
}

/** Each agent with its own default model and effort. */
export function defaultCompetitors(catalog: Catalog): CompetitorSpec[] {
  return VENDORS.flatMap((vendor) => {
    const first = catalog[vendor].models[0];
    return first ? [{ vendor, model: first.id, effort: null }] : [];
  });
}

/** "Opus · high effort" */
export function settingsLabel(spec: CompetitorSpec, catalog: Catalog): string {
  const label = findModel(catalog, spec.vendor, spec.model)?.label ?? spec.model;
  return `${label}${spec.effort ? ` · ${spec.effort} effort` : ""}`;
}

/** "Claude Code · Opus · high effort" */
export function competitorLabel(spec: CompetitorSpec, catalog: Catalog): string {
  return `${VENDOR_LABELS[spec.vendor]} · ${settingsLabel(spec, catalog)}`;
}

/** Groups identical configurations across comparisons. */
export function competitorKey(spec: CompetitorSpec): string {
  return `${spec.vendor}|${spec.model}|${spec.effort ?? "default"}`;
}
