import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createClaudeSession } from "@/lib/agents/claude";
import { createCodexSession } from "@/lib/agents/codex";
import { defaultCompetitors, VENDOR_LABELS, VENDORS } from "@/lib/domain/catalog";
import { createStepClock } from "@/lib/domain/timing";
import { errorText } from "@/lib/domain/text";
import type { ComparisonInfo, Outcome, StreamEvent } from "@/lib/domain/types";
import { loadCatalog } from "@/lib/server/catalog";
import { workDir } from "@/lib/server/config";
import { createWorkspace } from "@/lib/server/workspace";

export const runtime = "nodejs";

/** Runs one task on each agent in parallel, each in a fresh workspace, and streams their steps as NDJSON. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return Response.json({ error: "Type a task first." }, { status: 400 });

  const catalog = await loadCatalog();
  const specs = defaultCompetitors(catalog);
  const unavailable = VENDORS.flatMap((vendor) => {
    const error = catalog[vendor].error;
    return error ? [`${VENDOR_LABELS[vendor]}: ${error}`] : [];
  });
  if (!specs.length)
    return Response.json({ error: unavailable.join(" ") || "No agent reported any model." }, { status: 503 });

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const info: ComparisonInfo = {
        id: randomUUID(),
        competitors: specs.map((spec, slot) => ({ ...spec, id: String.fromCharCode(97 + slot), slot })),
        repeats: 1,
        check: null,
        blind: false,
        runs: specs.map((spec, slot) => ({
          runId: `${String.fromCharCode(97 + slot)}-1`,
          competitorId: String.fromCharCode(97 + slot),
          vendor: spec.vendor,
          index: 1,
        })),
      };
      send({ type: "comparison", info });
      send({ type: "turn_start", turnIndex: 0, prompt });
      for (const message of unavailable) send({ type: "fatal", message });
      await Promise.all(
        info.runs.map(async ({ runId }, slot) => {
          const spec = specs[slot];
          const stamp = createStepClock();
          const started = Date.now();
          const emit = (item: Parameters<typeof stamp>[0]) =>
            send({ type: "item", runId, turnIndex: 0, item: stamp(item) });
          let outcome: Outcome;
          try {
            const ws = await createWorkspace(join(workDir, info.id, runId));
            const session = spec.vendor === "claude" ? createClaudeSession(ws, spec) : createCodexSession(ws, spec);
            outcome = (await session.send(prompt, emit, abort.signal)).outcome;
          } catch (error) {
            outcome = { status: "error", detail: errorText(error) };
          }
          if (outcome.status === "error") emit({ id: randomUUID(), kind: "error", text: outcome.detail });
          send({ type: "run_end", runId, turnIndex: 0, outcome, wallMs: Date.now() - started });
        }),
      );
      send({ type: "turn_done", turnIndex: 0 });
      controller.close();
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
