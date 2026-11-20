// Types shared by the server (agents, runner, API routes) and the browser.

import type { Competitor, CompetitorSpec, Effort, Vendor } from "./catalog";
export type { Competitor, CompetitorSpec, Effort, Vendor };

export type ItemStatus = "running" | "ok" | "failed";

interface ItemBase {
  id: string;
  /** Milliseconds since the run started, when the step first appeared. Measured by Dyon. */
  t?: number;
  /** Milliseconds since the run started, when the step stopped running. */
  endT?: number;
  status?: ItemStatus;
  output?: string;
}

/**
 * One step of an agent run, shown as a row in the timeline. These are Dyon's display categories, not a copy
 * of what an agent sends: each agent's adapter maps every event it receives to one of them, unknown tools to
 * `tool` and unknown event types to `notice`, so nothing an agent does is dropped silently.
 */
export type TimelineItem = ItemBase &
  (
    | { kind: "message"; text: string }
    | { kind: "reasoning"; text: string }
    | { kind: "command"; command: string; exitCode?: number | null }
    | { kind: "file_read"; tool: string; target: string }
    | { kind: "file_edit"; tool: string; files: { path: string; change: string }[] }
    | { kind: "web_search"; query: string }
    | { kind: "web_fetch"; url: string }
    | { kind: "tool"; name: string; input: string }
    | { kind: "error"; text: string }
    /** Something the agent reports that is not an action: a retry, a rate limit, a context compaction, a refusal. */
    | { kind: "notice"; label: string; text: string }
    | { kind: "check"; command: string; passed: boolean; exitCode: number | null; durationMs: number; timedOut: boolean }
  );

/** Token counts reported by the agent. `input` includes cache reads and cache writes. */
export interface Tokens {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  /** Includes reasoning tokens. */
  output: number;
  reasoning: number;
}

/** Running totals of a session after its last turn; a turn's usage is the difference with the previous totals. */
export interface Cumulative {
  tokens: Tokens;
  reportedUsd: number | null;
  computedUsd: number | null;
  unpriced: string[];
  unpricedWebActions: number;
}

export type Outcome = { status: "completed" } | { status: "error"; detail: string } | { status: "aborted"; detail?: string };

export interface DiffFile {
  path: string;
  added: number | null;
  removed: number | null;
}

export interface CheckResult {
  command: string;
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  output: string;
}

export interface ActionCounts {
  commands: number;
  fileReads: number;
  fileEdits: number;
  webSearches: number;
  otherTools: number;
  failedActions: number;
}

/** A turn's cost: derived by Dyon for every agent, and reported by the agent when it gives one. */
export interface TurnCost {
  /** Reported tokens x published list prices. Null when a model has no known price. */
  computedUsd: number | null;
  /** The agent's own figure, null when it reports none. */
  reportedUsd: number | null;
  /** Models used in the turn that have no known price. */
  unpriced: string[];
  /** Web actions the derived cost could not include. */
  unpricedWebActions: number;
}

/** Everything known about one run on one turn. */
export interface RunTurnResult {
  /** Measured by Dyon around the agent call. */
  wallMs: number;
  /** Reported by the agent, for this turn only. Null when not reported. */
  tokens: Tokens | null;
  cost: TurnCost;
  outcome: Outcome;
  check: CheckResult | null;
  counts: ActionCounts;
  diff: { files: DiffFile[]; patch: string; truncated: boolean };
}

export interface RunInfo {
  /** `<competitorId>-<index>`, for example `a-1`. */
  runId: string;
  competitorId: string;
  vendor: Vendor;
  /** 1-based index among the repeated runs of the same competitor. */
  index: number;
}

export interface ComparisonInfo {
  id: string;
  competitors: Competitor[];
  /** 1, 3 or 5 runs per competitor. */
  repeats: number;
  /** Command run in each workspace after each turn, never shown to the agents. */
  check: string | null;
  /** Names are hidden until a verdict is recorded. */
  blind: boolean;
  runs: RunInfo[];
}

/** What a run needs to continue its session on the next turn. */
export interface RunState {
  seedCommit: string;
  session: { sessionId: string } | { threadId: string } | null;
  cumulative: Cumulative | null;
  model: string | null;
}

export type TurnState = "queued" | "running" | "done";

export interface TurnRecord {
  index: number;
  prompt: string;
  state: TurnState;
  startedAt: string;
  /** Server process that runs the turn, to detect a turn cut short by a restart. */
  bootId: string | null;
  items: Record<string, TimelineItem[]>;
  results: Record<string, RunTurnResult>;
  /** Turn-level message: interrupted, or failed before the runs could start. */
  error?: string;
}

/** The user's judgment of the whole comparison. */
export interface Verdict {
  /** A competitor id, "tie" or "all_bad". */
  winner: string;
  note: string;
  /** True when the names were hidden while judging. */
  blind: boolean;
  at: string;
}

/** A comparison as saved: the state the browser hydrates from. */
export interface ComparisonRecord {
  info: ComparisonInfo;
  createdAt: string;
  /** "busy" while a turn is queued or running. */
  status: "idle" | "busy";
  stopRequested: boolean;
  /** Number of the last live event included in this record. */
  seq: number;
  /** Reported by the agent, per run. */
  meta: Record<string, { model?: string; version?: string }>;
  runs: Record<string, RunState>;
  turns: TurnRecord[];
  verdict: Verdict | null;
}

/** What a running turn emits, as it happens. */
export type StreamEvent =
  | { type: "turn_start"; turnIndex: number; prompt: string }
  | { type: "run_meta"; runId: string; model?: string; version?: string }
  | { type: "item"; runId: string; turnIndex: number; item: TimelineItem }
  | { type: "run_done"; runId: string; turnIndex: number; result: RunTurnResult }
  | { type: "turn_done"; turnIndex: number }
  | { type: "fatal"; message: string };

/** A StreamEvent numbered within its comparison: `seq` grows by exactly 1 per event. */
export interface LiveEvent {
  seq: number;
  event: StreamEvent;
}

/** One run on one turn, kept for the scoreboard. */
export interface HistoryEntry {
  at: string;
  comparisonId: string;
  turnIndex: number;
  prompt: string;
  vendor: Vendor;
  requestedModel: string;
  effort: Effort | null;
  check: string | null;
  runIndex: number;
  /** Model the agent reported using. */
  model: string | null;
  wallMs: number;
  tokens: Tokens | null;
  /** Derived by Dyon, same method for every agent. */
  costUsd: number | null;
  outcome: Outcome["status"];
  checkPassed: boolean | null;
}
