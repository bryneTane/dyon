import { ImageResponse } from "next/og";
import { competitorLabel } from "@/lib/domain/catalog";
import { namesHidden } from "@/lib/domain/stall";
import { loadRecord, storedCatalog } from "@/lib/server/turns";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Dyon comparison report";

const COLORS = ["#d4744a", "#22a898", "#8b7cf6"];

/** Social preview: the task, the competitors and the verdict. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const record = await loadRecord((await params).id);
  const catalog = await storedCatalog();
  const prompt = (record?.turns[0]?.prompt ?? "Comparison not found").replace(/\s+/g, " ");
  const title = prompt.length > 110 ? `${prompt.slice(0, 109)}…` : prompt;
  const hidden = record ? namesHidden(record) : false;
  const competitors = record?.info.competitors ?? [];
  const winner = record?.verdict && competitors.find((c) => c.id === record.verdict!.winner);
  const verdictText = !record?.verdict
    ? "No verdict yet"
    : winner
      ? `Verdict: ${competitorLabel(winner, catalog)}`
      : record.verdict.winner === "tie"
        ? "Verdict: a tie"
        : "Verdict: none did good work";
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 64,
        background: "#09090b",
        color: "#fafafa",
      }}
    >
      <div style={{ display: "flex", fontSize: 28, color: "#a1a1aa" }}>Dyon · coding agents compared</div>
      <div style={{ display: "flex", fontSize: 54, fontWeight: 600, lineHeight: 1.15, letterSpacing: -1 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {competitors.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30 }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: COLORS[c.slot] }} />
            {hidden ? `Competitor ${c.id.toUpperCase()}` : competitorLabel(c, catalog)}
          </div>
        ))}
        <div style={{ display: "flex", fontSize: 30, color: "#a1a1aa", marginTop: 8 }}>{verdictText}</div>
      </div>
    </div>,
    size,
  );
}
