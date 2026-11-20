export const ORIGINS = {
  M: "Measured by Dyon",
  R: "Reported by the agent",
  D: "Derived by Dyon from reported values",
} as const;

export type OriginKind = keyof typeof ORIGINS;

/** Small mark saying where a number comes from; the tooltip gives the exact source or formula. */
export function Origin({ kind, detail }: { kind: OriginKind; detail?: string }) {
  return (
    <sup className="origin" title={detail ? `${ORIGINS[kind]}. ${detail}` : ORIGINS[kind]}>
      {kind}
    </sup>
  );
}
