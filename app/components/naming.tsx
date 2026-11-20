"use client";

import { createContext, useContext } from "react";
import { competitorLabel, settingsLabel, VENDOR_LABELS, type Catalog } from "@/lib/domain/catalog";
import type { Competitor, ComparisonInfo } from "@/lib/domain/types";
import { shortName } from "./competitors";

/** True while a blind comparison has no verdict: names, models and settings stay hidden. */
const HiddenContext = createContext(false);
export const NamesHidden = HiddenContext.Provider;

// Until the agents' catalog has loaded, models are shown by their id.
const CatalogContext = createContext<Catalog>({ claude: { models: [] }, codex: { models: [] } });
/** The models each agent offers, for their display names. */
export const CatalogProvider = CatalogContext.Provider;
export const useCatalog = () => useContext(CatalogContext);

export function useNaming(comparison: ComparisonInfo) {
  const hidden = useContext(HiddenContext);
  const catalog = useCatalog();
  const anonymous = (c: Competitor) => `Competitor ${c.id.toUpperCase()}`;
  return {
    hidden,
    /** Vendor, plus settings when two competitors share the vendor. */
    name: (c: Competitor) => (hidden ? anonymous(c) : shortName(comparison, c, catalog)),
    vendor: (c: Competitor) => (hidden ? anonymous(c) : VENDOR_LABELS[c.vendor]),
    full: (c: Competitor) => (hidden ? anonymous(c) : competitorLabel(c, catalog)),
    settings: (c: Competitor) => (hidden ? null : settingsLabel(c, catalog)),
  };
}

/** For server components (the report): hides names below it when `hidden`. */
export function HideNames({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  return <HiddenContext.Provider value={hidden}>{children}</HiddenContext.Provider>;
}
