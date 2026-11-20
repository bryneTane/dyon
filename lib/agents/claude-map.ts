// Converts Claude Agent SDK messages into Dyon's timeline steps. Pure: no I/O, so it is tested on recorded runs.
// Every vendor name used here is checked by the compiler against the SDK's own types.

import { BUILTIN_TOOL_NAMES, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  BashInput,
  FileEditInput,
  FileReadInput,
  FileWriteInput,
  GlobInput,
  GrepInput,
  NotebookEditInput,
  WebFetchInput,
  WebSearchInput,
} from "@anthropic-ai/claude-agent-sdk/sdk-tools";
import { priceClaude } from "@/lib/domain/pricing";
import type { Cumulative, Outcome, TimelineItem, Tokens } from "@/lib/domain/types";
import { clip, stringify } from "@/lib/domain/text";

type ToolName = (typeof BUILTIN_TOOL_NAMES)[number];
type ResultMessage = Extract<SDKMessage, { type: "result" }>;
type ModelUsage = ResultMessage["modelUsage"];

export interface ClaudeMapperContext {
  /** Shows a path relative to the workspace. */
  rel: (path: string) => string;
  newId: () => string;
}

/** Converts the messages of one turn, keeping track of tools still running. */
export function createClaudeMapper({ rel, newId }: ClaudeMapperContext) {
  const open = new Map<string, TimelineItem>();
  const state: { sessionId?: string; model?: string; version?: string; outcome?: Outcome; cumulative?: Cumulative } =
    {};

  const notice = (label: string, text: string): TimelineItem => ({ id: newId(), kind: "notice", label, text });

  /** The generic path: anything Dyon does not handle on purpose stays visible, under the vendor's own name. */
  const event = (name: string, value: object): TimelineItem => ({
    id: newId(),
    kind: "event",
    name,
    detail: clip(stringify(withoutIds(value)), 400),
  });

  function toolItem(id: string, name: string, input: unknown): TimelineItem {
    const running = { id, status: "running" as const };
    switch (name as ToolName) {
      case "Bash":
        return { ...running, kind: "command", command: (input as BashInput).command ?? "" };
      case "Read":
        return { ...running, kind: "file_read", tool: name, target: rel((input as FileReadInput).file_path ?? "") };
      case "Glob":
      case "Grep": {
        const { pattern, path } = input as GlobInput | GrepInput;
        return {
          ...running,
          kind: "file_read",
          tool: name,
          target: path ? `${pattern} in ${rel(path)}` : (pattern ?? ""),
        };
      }
      case "Write":
        return {
          ...running,
          kind: "file_edit",
          tool: name,
          files: [{ path: rel((input as FileWriteInput).file_path ?? ""), change: "write" }],
        };
      case "Edit":
        return {
          ...running,
          kind: "file_edit",
          tool: name,
          files: [{ path: rel((input as FileEditInput).file_path ?? ""), change: "edit" }],
        };
      case "NotebookEdit":
        return {
          ...running,
          kind: "file_edit",
          tool: name,
          files: [{ path: rel((input as NotebookEditInput).notebook_path ?? ""), change: "edit" }],
        };
      case "WebSearch":
        return { ...running, kind: "web_search", query: (input as WebSearchInput).query ?? "" };
      case "WebFetch":
        return { ...running, kind: "web_fetch", url: (input as WebFetchInput).url ?? "" };
      default:
        return { ...running, kind: "tool", name, input: clip(stringify(input), 400) };
    }
  }

  function map(message: SDKMessage): TimelineItem[] {
    switch (message.type) {
      case "assistant":
        return assistant(message);
      case "user":
        return toolResults(message);
      case "result":
        result(message);
        return [];
      case "rate_limit_event":
        if (message.rate_limit_info.status === "allowed") return [];
        return [
          notice(
            "Rate limit",
            message.rate_limit_info.status === "rejected" ? "Rate limit reached." : "Close to the rate limit.",
          ),
        ];
      case "system":
        return system(message);
      default:
        return [event(message.type, message)];
    }
  }

  function system(message: Extract<SDKMessage, { type: "system" }>): TimelineItem[] {
    switch (message.subtype) {
      case "init":
        state.sessionId = message.session_id;
        state.model = message.model;
        state.version = message.claude_code_version;
        return [];
      case "api_retry": {
        const status = message.error_status ? ` (HTTP ${message.error_status})` : "";
        return [
          notice(
            "API retry",
            `Attempt ${message.attempt} of ${message.max_retries}${status}, next in ${Math.round(message.retry_delay_ms / 1000)} s.`,
          ),
        ];
      }
      case "compact_boundary": {
        const c = message.compact_metadata;
        return [
          notice(
            "Context compacted",
            `${c.trigger === "auto" ? "Automatic" : "Manual"} compaction of ${c.pre_tokens.toLocaleString("en-US")} tokens.`,
          ),
        ];
      }
      case "permission_denied":
        return [notice("Permission denied", `${message.tool_name}: ${message.message}`)];
      case "model_refusal_fallback":
        return [notice("Model refusal", `${message.original_model} refused. Switched to ${message.fallback_model}.`)];
      case "model_refusal_no_fallback":
        return [notice("Model refusal", `${message.original_model} refused.`)];
      case "task_started":
        return [notice(message.is_backgrounded ? "Background task started" : "Task started", message.description)];
      case "task_notification":
        return [notice(`Task ${message.status}`, clip(message.summary, 400))];
      default:
        return [event(`system/${message.subtype}`, message)];
    }
  }

  function assistant(message: Extract<SDKMessage, { type: "assistant" }>): TimelineItem[] {
    const items: TimelineItem[] = [];
    for (const block of message.message.content) {
      switch (block.type) {
        case "text":
          if (block.text.trim()) items.push({ id: newId(), kind: "message", text: block.text });
          break;
        case "thinking":
          if (block.thinking.trim()) items.push({ id: newId(), kind: "reasoning", text: block.thinking });
          break;
        case "redacted_thinking":
          items.push({ id: newId(), kind: "reasoning", text: "(reasoning hidden by the provider)" });
          break;
        case "tool_use": {
          const item = toolItem(block.id, block.name, block.input);
          open.set(block.id, item);
          items.push(item);
          break;
        }
        default:
          items.push(event(`assistant/${block.type}`, block));
      }
    }
    return items;
  }

  function toolResults(message: Extract<SDKMessage, { type: "user" }>): TimelineItem[] {
    const content = message.message.content;
    if (!Array.isArray(content)) return [];
    const items: TimelineItem[] = [];
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const item = open.get(block.tool_use_id);
      if (!item) continue;
      open.delete(block.tool_use_id);
      items.push({ ...item, status: block.is_error ? "failed" : "ok", output: clip(resultText(block.content), 4000) });
    }
    return items;
  }

  function result(message: ResultMessage) {
    // `subtype` can be "success" while `is_error` is true, so `is_error` decides.
    if (message.is_error) {
      const errors = "errors" in message ? message.errors.join("; ") : "";
      state.outcome = { status: "error", detail: errors || message.subtype };
    } else {
      state.outcome = { status: "completed" };
    }
    state.cumulative = cumulativeFrom(message.total_cost_usd, message.modelUsage);
  }

  /** Tools that never got a result when the turn ended: closed as failed. */
  function finish(): TimelineItem[] {
    const items = [...open.values()].map((item): TimelineItem => ({
      ...item,
      status: "failed",
      output: "No result: the run ended first.",
    }));
    open.clear();
    return items;
  }

  return { map, finish, state };
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : stringify(part)))
      .join("\n");
  }
  return stringify(content);
}

function withoutIds(value: object): object {
  const { uuid: _uuid, session_id: _session, ...rest } = value as Record<string, unknown>;
  return rest;
}

/** Sums the running totals Claude Code reports per model (the main model plus helpers). */
export function cumulativeFrom(totalCostUsd: number, modelUsage: ModelUsage): Cumulative {
  const tokens: Tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };
  for (const usage of Object.values(modelUsage ?? {})) {
    tokens.input += usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
    tokens.cacheRead += usage.cacheReadInputTokens;
    tokens.cacheWrite += usage.cacheCreationInputTokens;
    tokens.output += usage.outputTokens;
    tokens.reasoning += usage.thinkingTokens ?? 0;
  }
  const priced = priceClaude(modelUsage ?? {});
  return {
    tokens,
    reportedUsd: totalCostUsd,
    computedUsd: priced.usd,
    unpriced: priced.missing,
    unpricedWebActions: 0,
  };
}
