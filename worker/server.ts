// The worker: runs the turns the web app hands it, and publishes their live events to the relay. A separate process from the web
// app, because a turn runs for minutes and executes the agents' commands.
import { createServer } from "node:http";
import { errorText } from "@/lib/domain/text";
import { loadCatalog } from "@/lib/server/catalog";
import { workerSecret } from "@/lib/server/config";
import { isId } from "@/lib/server/ids";
import { createPublisher } from "@/lib/server/realtime";
import { runTurn, stopAllTurns } from "@/lib/server/runner";
import { store } from "@/lib/server/store";

const PORT = Number(process.env.PORT ?? 3001);

if (!workerSecret) throw new Error("WORKER_SECRET is not set.");

/** Reads both agents' models from the agents themselves, for the web app; retried until both answer. */
async function publishCatalog(attempt = 1): Promise<void> {
  const catalog = await loadCatalog();
  await (await store()).setValue("catalog", catalog);
  if ((catalog.claude.error || catalog.codex.error) && attempt < 5)
    setTimeout(() => void publishCatalog(attempt + 1), 5_000 * attempt);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://worker");
  if (req.method === "GET" && url.pathname === "/health") return void res.writeHead(200).end("ok");
  if (req.headers.authorization !== `Bearer ${workerSecret}`) return void res.writeHead(401).end();
  if (req.method !== "POST" || url.pathname !== "/run") return void res.writeHead(404).end();
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const { comparisonId, turnIndex, room } = JSON.parse(body || "{}") as {
      comparisonId?: string;
      turnIndex?: number;
      /** The room's address and a publish token for it, from the web app: the worker holds no relay secret. */
      room?: { url: string; token: string };
    };
    if (!comparisonId || !isId(comparisonId) || typeof turnIndex !== "number" || !room)
      return void res.writeHead(400).end();
    res.writeHead(202).end();
    runTurn(comparisonId, turnIndex, createPublisher(room.url, room.token)).catch(async (error) => {
      // A failure that escapes the runner is saved on the turn, never lost.
      console.error(`Turn ${turnIndex} of ${comparisonId} failed:`, error);
      await (
        await store()
      )
        .update(comparisonId, (r) => ({
          ...r,
          status: "idle",
          turns: r.turns.map((t) => (t.index === turnIndex ? { ...t, state: "done", error: errorText(error) } : t)),
        }))
        .catch((saveError) => console.error(`Could not save the failure of ${comparisonId}:`, saveError));
    });
  });
});

// Stopped (Ctrl+C, a deploy, a machine reclaimed): close the running turns cleanly before exiting.
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    console.log(`${signal}: stopping the running turns`);
    void stopAllTurns("The worker was stopped while this turn was running.").finally(() => process.exit(0));
  });

server.listen(PORT, () => console.log(`Worker listening on http://localhost:${PORT}`));
void publishCatalog();
