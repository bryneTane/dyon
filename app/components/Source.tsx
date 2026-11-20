const SOURCES = {
  M: "Measured by Dyon",
  R: "Reported by the agent",
  D: "Derived by Dyon from reported values",
} as const;

/** Small superscript telling where a number comes from; the tooltip gives the exact source or formula. */
export function Source({ kind, detail }: { kind: keyof typeof SOURCES; detail?: string }) {
  return (
    <sup className="src" title={detail ? `${SOURCES[kind]}. ${detail}` : SOURCES[kind]}>
      {kind}
    </sup>
  );
}
