// The worker, locally: a process the web app hands turns to. Hosted, each turn is a Cloud Run Job execution
// instead (job.ts). Either way the worker holds no database, storage or relay credentials: only the token the web
// app gives with each turn, for that comparison.
import { createServer } from "node:http";
import { stopAllTurns } from "./run-turn";
import { reportCatalog, runTurn } from "./tasks";

const PORT = Number(process.env.PORT ?? 3001);
/** Shared with the web app, so only it can hand turns to this process. */
const SECRET = process.env.WORKER_SECRET ?? "";
if (!SECRET) throw new Error("WORKER_SECRET is not set.");

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return void res.writeHead(200).end("ok");
  if (req.headers.authorization !== `Bearer ${SECRET}`) return void res.writeHead(401).end();
  if (req.method !== "POST" || (req.url !== "/run" && req.url !== "/catalog")) return void res.writeHead(404).end();
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const { COMPARISON_ID: id, token } = JSON.parse(body || "{}") as { COMPARISON_ID?: string; token?: string };
    if (!token || (req.url === "/run" && !id)) return void res.writeHead(400).end();
    res.writeHead(202).end();
    const task = req.url === "/run" ? runTurn(id!, token) : reportCatalog(token);
    task.catch((error) => console.error(`${req.url} failed:`, error));
  });
});

// Stopped (Ctrl+C, a restart): close the running turns cleanly before exiting.
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    console.log(`${signal}: stopping the running turns`);
    void stopAllTurns("The worker was stopped while this turn was running.").finally(() => process.exit(0));
  });

server.listen(PORT, () => console.log(`Worker listening on http://localhost:${PORT}`));
