import "server-only";
import { randomUUID } from "node:crypto";
import { isValidSpec, VENDOR_LABELS, type Catalog } from "@/lib/domain/catalog";
import { closeInterruptedTurn } from "@/lib/domain/interrupted";
import { newRecord, newTurn } from "@/lib/domain/record";
import type { CreateBody } from "@/lib/domain/schemas";
import { errorText } from "@/lib/domain/text";
import type { ComparisonInfo, ComparisonRecord } from "@/lib/domain/types";
import { isId } from "./ids";
import { bootId, runTurn } from "./runner";
import { store } from "./store";

/**
 * The saved comparison, with any turn cut short by a server restart closed first, so the page never waits
 * for a turn that cannot finish and a follow-up is accepted.
 */
export function loadRecord(id: string): ComparisonRecord | null {
  const record = isId(id) ? store().get(id) : null;
  if (!record || !closeInterruptedTurn(record, bootId)) return record;
  return store().update(id, (r) => closeInterruptedTurn(r, bootId) ?? r);
}

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

/**
 * Adds a follow-up to every run: each agent continues its own session in its own workspace. Refused while a
 * turn is queued or running. The check and the new turn are written in one transaction, so two follow-ups
 * sent at once cannot both start.
 */
export function addTurn(id: string, prompt: string): { turnIndex: number } | { error: string; status: number } {
  let turnIndex = -1;
  try {
    if (!loadRecord(id)) return { error: "This comparison does not exist.", status: 404 };
    store().update(id, (record) => {
      if (record.status === "busy") throw new Busy();
      turnIndex = record.turns.length;
      return {
        ...record,
        status: "busy",
        stopRequested: false,
        turns: [...record.turns, newTurn(turnIndex, prompt, new Date().toISOString())],
      };
    });
  } catch (error) {
    if (error instanceof Busy) return { error: "Wait for the current turn to finish.", status: 409 };
    return { error: errorText(error), status: 404 };
  }
  start(id, turnIndex);
  return { turnIndex };
}

class Busy extends Error {}

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
