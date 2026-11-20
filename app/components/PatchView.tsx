"use client";

import { useMemo } from "react";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";

// Highlighted by file name (Shiki), following the system's light or dark mode.
const THEME = { theme: { dark: "pierre-dark", light: "pierre-light" }, themeType: "system" } as const;

/** A unified git patch, one highlighted diff per file; the raw text if it cannot be parsed. */
export function PatchView({ patch }: { patch: string }) {
  const files = useMemo(() => {
    try {
      return parsePatchFiles(patch).flatMap((p) => p.files);
    } catch {
      return null;
    }
  }, [patch]);
  if (!files) return <pre className="patch">{patch}</pre>;
  return (
    <div className="patch-files">
      {files.map((fileDiff, i) => (
        <FileDiff key={i} fileDiff={fileDiff} options={{ ...THEME, diffStyle: "unified", overflow: "scroll" }} />
      ))}
    </div>
  );
}
