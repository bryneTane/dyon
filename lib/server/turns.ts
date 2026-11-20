import "server-only";
import { randomUUID } from "node:crypto";
import { isValidSpec, VENDOR_LABELS, type Catalog } from "@/lib/domain/catalog";
import { newRecord, newTurn } from "@/lib/domain/record";
import type { CreateBody } from "@/lib/domain/schemas";
import { closeStalledTurn } from "@/lib/domain/stall";
import { errorText } from "@/lib/domain/text";
import type { ComparisonInfo, ComparisonRecord } from "@/lib/domain/types";
import { dispatchCatalog, dispatchTurn } from "./dispatch";
import { isId } from "./ids";
import { store } from "./store";

/** A catalog older than this is read again from the agents, so new models show up. */
const CATALOG_MAX_AGE_MS = 24 * 3600_000;
/** At most one worker is started to read the models in this time. */
const CATALOG_RETRY_MS = 2 * 60_000;

/**
 * The agents' catalog as a worker last read it from the agents themselves. When there is none, it is old, or it
 * holds an error, a worker is started to read it again (the web app cannot run the agents).
 */
export async function storedCatalog(): Promise<Catalog> {
  const db = await store();
  const [catalog, at, requestedAt] = await Promise.all([
    db.getValue<Catalog>("catalog"),
    db.getValue<string>("catalogAt"),
    db.getValue<string>("catalogRequestedAt"),
  ]);
  const age = (iso: string | null) => (iso ? Date.now() - Date.parse(iso) : Infinity);
  const stale = !catalog || catalog.claude.error || catalog.codex.error || age(at) > CATALOG_MAX_AGE_MS;
  if (stale && age(requestedAt) > CATALOG_RETRY_MS) {
    await db.setValue("catalogRequestedAt", new Date().toISOString());
    dispatchCatalog().catch((error) => console.error("Could not start a worker to read the models:", error));
  }
  if (catalog) return catalog;
  const error = "Reading this agent's models. Try again in a minute.";
  return { claude: { models: [], error }, codex: { models: [], error } };
}

/**
 * The saved comparison, with a turn that can no longer finish closed first (its worker stopped sending signs of
 * life, or none started it), so the page never waits for it and a follow-up is accepted.
 */
export async function loadRecord(id: string): Promise<ComparisonRecord | null> {
  if (!isId(id)) return null;
  const db = await store();
  const record = await db.get(id);
  if (!record || !closeStalledTurn(record)) return record;
  return db.update(id, (r) => closeStalledTurn(r) ?? r);
}

/** Saves a new comparison with its first turn queued, hands the turn to the worker, returns its id. */
export async function createComparison(body: CreateBody): Promise<{ id: string } | { error: string }> {
  const catalog = await storedCatalog();
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
  await (await store()).insert(newRecord(info, body.prompt, new Date().toISOString()));
  await dispatch(info.id, 0);
  return { id: info.id };
}

/**
 * Adds a follow-up to every run: each agent continues its own session in its own workspace. Refused while a
 * turn is queued or running. The check and the new turn are written in one transaction, so two follow-ups
 * sent at once cannot both start.
 */
export async function addTurn(
  id: string,
  prompt: string,
): Promise<{ turnIndex: number } | { error: string; status: number }> {
  if (!(await loadRecord(id))) return { error: "This comparison does not exist.", status: 404 };
  let turnIndex = -1;
  try {
    await (
      await store()
    ).update(id, (record) => {
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
  await dispatch(id, turnIndex);
  return { turnIndex };
}

class Busy extends Error {}

/**
 * Hands a queued turn to the worker. If the worker cannot be reached, the turn is closed with the reason, so
 * the comparison is never left waiting.
 */
async function dispatch(id: string, turnIndex: number): Promise<void> {
  try {
    await dispatchTurn(id);
  } catch (error) {
    console.error(`Could not hand turn ${turnIndex} of ${id} to the worker:`, error);
    await (
      await store()
    ).update(id, (r) => ({
      ...r,
      status: "idle",
      turns: r.turns.map((t) =>
        t.index === turnIndex
          ? { ...t, state: "done", error: `The worker could not be reached: ${errorText(error)}` }
          : t,
      ),
    }));
  }
}
