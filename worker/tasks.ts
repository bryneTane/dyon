import { loadCatalog } from "@/lib/server/catalog";
import { workerApi } from "./api";
import { runTurnJob } from "./run-turn";

/** The web app's address: the worker's only way to the database, storage and relay. */
export const apiUrl = (process.env.DYON_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Runs the queued turn of a comparison, with the token the web app gave for it. */
export function runTurn(comparisonId: string, token: string): Promise<void> {
  return runTurnJob(workerApi(apiUrl, comparisonId, token));
}

/** Reads both agents' models from the agents themselves and reports them to the web app. */
export async function reportCatalog(token: string): Promise<void> {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const answer = await fetch(`${apiUrl}/api/worker/catalog`, { headers });
  if (!answer.ok) throw new Error(`The web app answered ${answer.status}.`);
  const { keys } = (await answer.json()) as { keys: { anthropic?: string } };
  const catalog = await loadCatalog(keys.anthropic ?? "");
  const saved = await fetch(`${apiUrl}/api/worker/catalog`, { method: "PUT", headers, body: JSON.stringify(catalog) });
  if (!saved.ok) throw new Error(`The web app refused the models: ${saved.status}.`);
  console.log("Models reported.");
}
