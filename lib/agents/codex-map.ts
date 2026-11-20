// Converts Codex SDK events into Dyon's timeline steps. Pure: no I/O, so it is tested on recorded runs.
// Every vendor name used here is checked by the compiler against the SDK's own types.

import type { ThreadEvent, ThreadItem, Usage } from "@openai/codex-sdk";
import type { Cumulative, ItemStatus, Outcome, TimelineItem } from "@/lib/domain/types";
import { clip, stringify } from "@/lib/domain/text";

export interface CodexMapperContext {
  /** Shows a path relative to the workspace. */
  rel: (path: string) => string;
  newId: () => string;
}

type Phase = "item.started" | "item.updated" | "item.completed";

/** Converts the events of one turn. Codex sends each item again as it changes, under the same id. */
export function createCodexMapper({ rel, newId }: CodexMapperContext) {
  const state: { threadId?: string; outcome?: Outcome; cumulative?: Cumulative } = {};

  function item(item: ThreadItem, phase: Phase): TimelineItem[] {
    const done: ItemStatus = phase === "item.completed" ? "ok" : "running";
    switch (item.type) {
      case "agent_message":
        return item.text.trim() ? [{ id: item.id, kind: "message", text: item.text }] : [];
      case "reasoning":
        return item.text.trim() ? [{ id: item.id, kind: "reasoning", text: item.text }] : [];
      case "command_execution":
        return [
          {
            id: item.id,
            kind: "command",
            command: item.command,
            exitCode: item.exit_code ?? null,
            status: item.status === "in_progress" ? "running" : item.status === "completed" ? "ok" : "failed",
            output: item.aggregated_output ? clip(item.aggregated_output, 4000, "end") : undefined,
          },
        ];
      case "file_change":
        return [
          {
            id: item.id,
            kind: "file_edit",
            tool: "patch",
            files: item.changes.map((c) => ({ path: rel(c.path), change: c.kind })),
            status: item.status === "completed" ? "ok" : "failed",
          },
        ];
      case "mcp_tool_call":
        return [
          {
            id: item.id,
            kind: "tool",
            name: `${item.server}.${item.tool}`,
            input: clip(stringify(item.arguments), 400),
            status: item.status === "in_progress" ? "running" : item.status === "completed" ? "ok" : "failed",
            output: item.error?.message ?? (item.result ? clip(stringify(item.result.content), 4000) : undefined),
          },
        ];
      case "web_search":
        return [{ id: item.id, kind: "web_search", query: item.query, status: done }];
      case "todo_list":
        return [
          {
            id: item.id,
            kind: "notice",
            label: "Plan",
            text: item.items.map((t) => `${t.completed ? "[x]" : "[ ]"} ${t.text}`).join("\n"),
          },
        ];
      case "error":
        return [{ id: item.id, kind: "error", text: item.message }];
      default:
        return [unhandled(`item/${(item as { type: string }).type}`, item)];
    }
  }

  function unhandled(name: string, value: object): TimelineItem {
    return { id: newId(), kind: "event", name, detail: clip(stringify(value), 400) };
  }

  function map(event: ThreadEvent): TimelineItem[] {
    switch (event.type) {
      case "thread.started":
        state.threadId = event.thread_id;
        return [];
      case "turn.started":
        return [];
      case "item.started":
      case "item.updated":
      case "item.completed":
        return item(event.item, event.type);
      case "turn.completed":
        state.outcome = { status: "completed" };
        state.cumulative = cumulativeFrom(event.usage);
        return [];
      case "turn.failed":
        state.outcome = { status: "error", detail: event.error.message };
        return [{ id: newId(), kind: "error", text: event.error.message }];
      case "error":
        state.outcome = { status: "error", detail: event.message };
        return [{ id: newId(), kind: "error", text: event.message }];
      default:
        return [unhandled((event as { type: string }).type, event)];
    }
  }

  return { map, state };
}

/**
 * Codex's `usage` holds the thread's running totals, although the SDK describes it as the usage "during a turn":
 * on a two-turn run (2026-11-20, SDK 0.169.1) the second turn reported 91,538 input tokens, equal to the
 * `total_token_usage` in Codex's own session log, while that turn alone used 31,041. A turn's usage is
 * therefore the difference between two totals, as for Claude Code. Input includes cached reads and cache writes.
 */
export function cumulativeFrom(usage: Usage): Cumulative {
  return {
    tokens: {
      input: usage.input_tokens,
      cacheRead: usage.cached_input_tokens,
      cacheWrite: usage.cache_write_input_tokens,
      output: usage.output_tokens,
      reasoning: usage.reasoning_output_tokens,
    },
    reportedUsd: null,
    computedUsd: null,
    unpriced: [],
    unpricedWebActions: 0,
  };
}
