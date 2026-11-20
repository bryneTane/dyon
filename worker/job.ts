// Cloud Run Jobs entrypoint: one execution runs one turn of one comparison (or reads the agents' models). The web
// app passes the comparison id and a token for it; the job holds no other credential. The process lives exactly
// as long as the turn, so the platform cannot reclaim it mid-run.
import { stopAllTurns } from "./run-turn";
import { reportCatalog, runTurn } from "./tasks";

const token = process.env.WORKER_TOKEN;
const comparisonId = process.env.COMPARISON_ID;
if (!token || (!comparisonId && process.env.DYON_MODE !== "catalog")) {
  console.error("WORKER_TOKEN and COMPARISON_ID (or DYON_MODE=catalog) must be set.");
  process.exit(1);
}

// Cloud Run sends SIGTERM before stopping an execution and waits 10 seconds: close the turn with a clear message
// instead of leaving it to the stalled-turn check.
process.on("SIGTERM", () => {
  void stopAllTurns("The platform stopped the worker while this turn was running.").finally(() => process.exit(0));
});

(comparisonId ? runTurn(comparisonId, token) : reportCatalog(token))
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed:", error);
    process.exit(1);
  });
