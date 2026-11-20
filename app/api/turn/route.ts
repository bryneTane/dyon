import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createClaudeSession } from "@/lib/agents/claude";
import { defaultCompetitors } from "@/lib/domain/catalog";
import { errorText } from "@/lib/domain/text";
import type { StreamEvent } from "@/lib/domain/types";
import { loadCatalog } from "@/lib/server/catalog";
import { workDir } from "@/lib/server/config";
import { createWorkspace } from "@/lib/server/workspace";

export const runtime = "nodejs";

/** Runs one task on Claude Code in a fresh workspace and streams its steps as NDJSON, one StreamEvent per line. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return Response.json({ error: "Type a task first." }, { status: 400 });

  const spec = defaultCompetitors(await loadCatalog()).find((c) => c.vendor === "claude");
  if (!spec) return Response.json({ error: "Claude Code did not report any model." }, { status: 503 });

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  const runId = "a-1";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const ws = await createWorkspace(join(workDir, randomUUID(), runId));
        const session = createClaudeSession(ws, spec);
        send({ type: "turn_start", turnIndex: 0, prompt });
        const report = await session.send(
          prompt,
          (item) => send({ type: "item", runId, turnIndex: 0, item }),
          abort.signal,
        );
        if (report.outcome.status === "error") send({ type: "fatal", message: report.outcome.detail });
        send({ type: "turn_done", turnIndex: 0 });
      } catch (error) {
        send({ type: "fatal", message: errorText(error) });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
