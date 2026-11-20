import { settingsLabel, VENDOR_LABELS, type Catalog, type Competitor } from "@/lib/domain/catalog";
import type { ComparisonInfo, RunInfo } from "@/lib/domain/types";

/** CSS class giving a competitor its color (by position, fixed for the whole comparison). */
export const slotClass = (c: Competitor) => `slot-${c.slot}`;

export function competitorOf(comparison: ComparisonInfo, run: RunInfo): Competitor {
  return comparison.competitors.find((c) => c.id === run.competitorId)!;
}

export function runsOf(comparison: ComparisonInfo, competitor: Competitor): RunInfo[] {
  return comparison.runs.filter((r) => r.competitorId === competitor.id);
}

/** Vendor name, plus the settings when two competitors share the vendor or when asked. */
export function shortName(comparison: ComparisonInfo, c: Competitor, catalog: Catalog): string {
  const sameVendor = comparison.competitors.filter((o) => o.vendor === c.vendor).length > 1;
  return sameVendor ? `${VENDOR_LABELS[c.vendor]} · ${settingsLabel(c, catalog)}` : VENDOR_LABELS[c.vendor];
}
