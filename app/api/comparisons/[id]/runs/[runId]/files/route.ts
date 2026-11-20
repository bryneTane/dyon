import { join } from "node:path";
import { workDir } from "@/lib/server/config";
import { isId } from "@/lib/server/ids";
import { store } from "@/lib/server/store";
import { listFiles, openWorkspace, readRawFile, readWorkspaceFile, zipWorkspace } from "@/lib/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A run's files, read from its workspace.
 * GET                      file list
 * GET ?path=p              file content as JSON (text or binary marker)
 * GET ?path=p&download=1   the file itself, as an attachment
 * GET ?zip=1               all files as a .zip
 */
export async function GET(request: Request, ctx: RouteContext<"/api/comparisons/[id]/runs/[runId]/files">) {
  const { id, runId } = await ctx.params;
  const record = isId(id) ? await (await store()).get(id) : null;
  if (!record || !record.info.runs.some((r) => r.runId === runId))
    return Response.json({ error: "This run does not exist." }, { status: 404 });
  try {
    const ws = await openWorkspace(join(workDir, id, runId));
    const query = new URL(request.url).searchParams;
    const path = query.get("path");
    if (query.get("zip")) {
      const zip = await zipWorkspace(ws);
      return new Response(new Uint8Array(zip), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="dyon-${runId}.zip"`,
        },
      });
    }
    if (!path) return Response.json({ files: await listFiles(ws) });
    if (query.get("download")) {
      const bytes = await readRawFile(ws, path);
      if (!bytes) return Response.json({ error: "File not found in this run." }, { status: 404 });
      const name = (path.split("/").pop() ?? "file").replace(/"/g, "");
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${name}"`,
        },
      });
    }
    const content = await readWorkspaceFile(ws, path);
    return content ? Response.json(content) : Response.json({ error: "File not found in this run." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
