import "server-only";
import { randomUUID } from "node:crypto";
import { isValidSpec, VENDOR_LABELS, type Catalog } from "@/lib/domain/catalog";
import { newRecord } from "@/lib/domain/record";
import type { CreateBody } from "@/lib/domain/schemas";
import { errorText } from "@/lib/domain/text";
import type { ComparisonInfo } from "@/lib/domain/types";
import { runTurn } from "./runner";
import { store } from "./store";

/** Saves a new comparison with its first turn queued, starts the turn without waiting for it, returns its id. */
export function createComparison(body: CreateBody, catalog: Catalog): { id: string } | { error: string } {
  for (const spec of body.competitors) {
    const { vendor, model } = spec;
    if (catalog[vendor].error) return { error: `${VENDOR_LABELS[vendor]}: ${catalog[vendor].error}` };
    if (!isValidSpec(spec, catalog))
      return { error: `${VENDOR_LABELS[vendor]} does not offer ${model} with this effort level.` };
  }
  const competitors = body.competitors.map((spec, slot) => ({ ...spec, id: String.fromCharCode(97 + slot), slot }));
  const info: ComparisonInfo = {
    id: randomUUID(),
    competitors,
    repeats: body.repeats,
    check: body.check,
    blind: body.blind,
    runs: competitors.flatMap((c) =>
      Array.from({ length: body.repeats }, (_, i) => ({
        runId: `${c.id}-${i + 1}`,
        competitorId: c.id,
        vendor: c.vendor,
        index: i + 1,
      })),
    ),
  };
  store().insert(newRecord(info, body.prompt, new Date().toISOString()));
  start(info.id, 0);
  return { id: info.id };
}

/** Runs a turn in the background. A failure that escapes the runner is saved on the turn, never lost. */
function start(id: string, turnIndex: number): void {
  runTurn(id, turnIndex).catch((error) => {
    console.error(`Turn ${turnIndex} of ${id} failed:`, error);
    try {
      store().update(id, (r) => ({
        ...r,
        status: "idle",
        turns: r.turns.map((t) => (t.index === turnIndex ? { ...t, state: "done", error: errorText(error) } : t)),
      }));
    } catch (saveError) {
      console.error(`Could not save the failure of ${id}:`, saveError);
    }
  });
}
