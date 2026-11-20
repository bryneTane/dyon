import { blobs } from "@/lib/server/blobs";
import { readList, readZip, readZipEntry, runSnapshot } from "@/lib/server/run-files";
import { fileContent } from "@/lib/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A run's files as saved after its latest finished turn (file list and zip written by the worker).
 * GET                      file list
 * GET ?path=p              file content as JSON (text or binary marker)
 * GET ?path=p&download=1   the file itself, as an attachment
 * GET ?zip=1               all files as a .zip (a direct link to the storage when it has one)
 */
export async function GET(request: Request, ctx: RouteContext<"/api/comparisons/[id]/runs/[runId]/files">) {
  const { id, runId } = await ctx.params;
  try {
    const snapshot = await runSnapshot(id, runId);
    if ("error" in snapshot) return Response.json({ error: snapshot.error }, { status: snapshot.status });
    const query = new URL(request.url).searchParams;
    const path = query.get("path");
    const tooLarge = Response.json(
      { error: "The files of this run were too large to keep (over 100 MB)." },
      { status: 404 },
    );
    if (query.get("zip")) {
      const filename = `dyon-${runId}.zip`;
      const url = await (await blobs()).downloadUrl(snapshot.zip, filename);
      if (url) return Response.redirect(url, 302);
      const zip = await readZip(snapshot.zip);
      if (!zip) return tooLarge;
      return new Response(new Uint8Array(zip), {
        headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${filename}"` },
      });
    }
    if (!path) {
      const files = await readList(snapshot.list);
      return files
        ? Response.json({ files, turn: snapshot.turn })
        : Response.json({ error: "No files saved yet." }, { status: 404 });
    }
    const bytes = await readZipEntry(snapshot.zip, path);
    if (!bytes) return Response.json({ error: "File not found in this run." }, { status: 404 });
    if (query.get("download")) {
      const name = (path.split("/").pop() ?? "file").replace(/"/g, "");
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${name}"`,
        },
      });
    }
    return Response.json(fileContent(path, bytes));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
