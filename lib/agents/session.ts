import "server-only";
import type { CompetitorSpec, Cumulative, Outcome, RunState, TimelineItem, Tokens } from "@/lib/domain/types";
import type { Workspace } from "@/lib/server/workspace";

/** What an agent reports at the end of a turn. */
export interface TurnReport {
  outcome: Outcome;
  /** Running totals after this turn, or null if the agent reported none. */
  cumulative: Cumulative | null;
  model?: string;
  version?: string;
}

export type ItemSink = (item: TimelineItem) => void;

/**
 * One agent conversation in one workspace; each `send` is one turn. Every agent sits behind this
 * interface, so the rest of Dyon never depends on a specific SDK.
 */
export interface AgentSession {
  readonly spec: CompetitorSpec;
  readonly workspace: Workspace;
  /** What must be saved to continue this conversation on the next turn. */
  state(): RunState["session"];
  send(prompt: string, emit: ItemSink, signal: AbortSignal): Promise<TurnReport>;
}

export const ZERO_TOKENS: Tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };

/** One turn's usage from two running totals. */
export function subtractTokens(after: Tokens, before: Tokens): Tokens {
  return {
    input: after.input - before.input,
    cacheRead: after.cacheRead - before.cacheRead,
    cacheWrite: after.cacheWrite - before.cacheWrite,
    output: after.output - before.output,
    reasoning: after.reasoning - before.reasoning,
  };
}
