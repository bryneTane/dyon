// Cloud Run Jobs entrypoint: one execution runs one turn of one comparison (or reads the agents' models). The web
// app passes the comparison id and a token for it; the job holds no other credential. The process lives exactly
// as long as the turn, so the platform cannot reclaim it mid-run.

/** Milliseconds since the process started, for the startup timings in the job's logs. */
const since = () => Math.round(process.uptime() * 1000);

async function main() {
  console.log(`Process started ${since()} ms ago; loading the worker.`);
  const { stopAllTurns } = await import("./run-turn");
  const { reportCatalog, runTurn } = await import("./tasks");
  console.log(`Worker loaded at ${since()} ms.`);

  const token = process.env.WORKER_TOKEN;
  const comparisonId = process.env.COMPARISON_ID;
  if (!token || (!comparisonId && process.env.DYON_MODE !== "catalog"))
    throw new Error("WORKER_TOKEN and COMPARISON_ID (or DYON_MODE=catalog) must be set.");

  // Cloud Run sends SIGTERM before stopping an execution and waits 10 seconds: close the turn with a clear
  // message instead of leaving it to the stalled-turn check.
  process.on("SIGTERM", () => {
    void stopAllTurns("The platform stopped the worker while this turn was running.").finally(() => process.exit(0));
  });
  await (comparisonId ? runTurn(comparisonId, token) : reportCatalog(token));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed:", error);
    process.exit(1);
  });
