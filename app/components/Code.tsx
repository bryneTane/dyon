"use client";

import { useMemo } from "react";
import { File, FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs";

// @pierre/diffs renders with Shiki (VS Code's TextMate grammars): the language comes from the file name.
const THEME = { theme: "pierre-dark", themeType: "dark" } as const;

export function CodeFile({ name, contents }: { name: string; contents: string }) {
  return <File file={{ name, contents }} options={{ ...THEME, overflow: "scroll", disableFileHeader: true }} />;
}

/** A code block from an agent message, highlighted by language. */
export function CodeSnippet({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="snippet">
      <File
        file={{ name: `snippet.${lang}`, contents: code, lang }}
        options={{ ...THEME, overflow: "scroll", disableFileHeader: true }}
      />
    </div>
  );
}

/** A unified git patch with several files, one highlighted diff per file. */
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
