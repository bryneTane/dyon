import { readFileSync } from "node:fs";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { createClaudeMapper } from "@/lib/agents/claude-map";
import type { TimelineItem } from "@/lib/domain/types";

function mapper() {
  let n = 0;
  return createClaudeMapper({ rel: (p) => p.replace(/^\/run\/workspace\//, ""), newId: () => `id-${++n}` });
}

function mapAll(messages: unknown[]) {
  const m = mapper();
  const items: TimelineItem[] = messages.flatMap((message) => m.map(message as SDKMessage));
  return { items: [...items, ...m.finish()], state: m.state };
}

describe("a recorded run: Create hello.py that prints Hello and run it", () => {
  const recorded = readFileSync(new URL("./fixtures/claude-hello.jsonl", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const { items, state } = mapAll(recorded);

  it("shows the command running, then its output, then the final message", () => {
    expect(items.map((i) => `${i.kind}:${i.status ?? ""}`)).toEqual(["command:running", "command:ok", "message:"]);
    const done = items[1] as Extract<TimelineItem, { kind: "command" }>;
    expect(done.command).toContain("hello.py");
    expect(done.output).toContain("Hello");
    expect(items[0].id).toBe(items[1].id);
  });

  it("keeps the session, the model and the version the agent reported", () => {
    expect(state.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.model).toBe("claude-opus-5-5");
    expect(state.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("ends completed with the agent's running totals", () => {
    expect(state.outcome).toEqual({ status: "completed" });
    const c = state.cumulative!;
    expect(c.reportedUsd).toBeGreaterThan(0);
    expect(c.tokens.output).toBeGreaterThan(0);
    expect(c.tokens.input).toBeGreaterThanOrEqual(c.tokens.cacheRead + c.tokens.cacheWrite);
  });
});

// Hand-written messages for cases the recorded run does not contain. Their names and fields are the SDK's
// (see its sdk.d.ts and sdk-tools.d.ts); the converter itself is type-checked against them.
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const toolResult = (id: string, content: string, is_error = false) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error }] },
});

describe("tools", () => {
  it("maps reads, edits, web searches and fetches to their own kinds", () => {
    const { items } = mapAll([
      toolUse("1", "Read", { file_path: "/run/workspace/src/a.ts" }),
      toolUse("2", "Grep", { pattern: "TODO", path: "/run/workspace/src" }),
      toolUse("3", "Write", { file_path: "/run/workspace/b.py", content: "x" }),
      toolUse("4", "Edit", { file_path: "/run/workspace/b.py" }),
      toolUse("5", "WebSearch", { query: "vitest docs" }),
      toolUse("6", "WebFetch", { url: "https://example.com" }),
    ]);
    expect(items.slice(0, 6)).toMatchObject([
      { kind: "file_read", tool: "Read", target: "src/a.ts" },
      { kind: "file_read", tool: "Grep", target: "TODO in src" },
      { kind: "file_edit", tool: "Write", files: [{ path: "b.py", change: "write" }] },
      { kind: "file_edit", tool: "Edit", files: [{ path: "b.py", change: "edit" }] },
      { kind: "web_search", query: "vitest docs" },
      { kind: "web_fetch", url: "https://example.com" },
    ]);
  });

  it("keeps any other tool under its real name", () => {
    const { items } = mapAll([toolUse("1", "SomeFutureTool", { a: 1 }), toolResult("1", "done")]);
    expect(items).toMatchObject([
      { kind: "tool", name: "SomeFutureTool", input: '{"a":1}', status: "running" },
      { kind: "tool", name: "SomeFutureTool", status: "ok", output: "done" },
    ]);
  });

  it("marks a failed tool and closes tools left without a result", () => {
    const { items } = mapAll([
      toolUse("1", "Bash", { command: "false" }),
      toolResult("1", "exit 1", true),
      toolUse("2", "Bash", { command: "sleep 99" }),
    ]);
    expect(items.map((i) => i.status)).toEqual(["running", "failed", "running", "failed"]);
    expect(items[3].output).toBe("No result: the run ended first.");
  });
});

describe("messages that are not actions", () => {
  it("shows retries, compactions, refusals and denied permissions as notices", () => {
    const { items } = mapAll([
      { type: "system", subtype: "api_retry", attempt: 2, max_retries: 10, retry_delay_ms: 4000, error_status: 529 },
      { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 150000 } },
      { type: "system", subtype: "model_refusal_no_fallback", original_model: "claude-opus-5-5", content: "" },
      { type: "system", subtype: "permission_denied", tool_name: "Bash", message: "Blocked." },
    ]);
    expect(items).toMatchObject([
      { kind: "notice", label: "API retry", text: "Attempt 2 of 10 (HTTP 529), next in 4 s." },
      { kind: "notice", label: "Context compacted", text: "Automatic compaction of 150,000 tokens." },
      { kind: "notice", label: "Model refusal", text: "claude-opus-5-5 refused." },
      { kind: "notice", label: "Permission denied", text: "Bash: Blocked." },
    ]);
  });

  it("shows a rate limit only when it is close or reached", () => {
    expect(mapAll([{ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }]).items).toEqual([]);
    expect(mapAll([{ type: "rate_limit_event", rate_limit_info: { status: "rejected" } }]).items).toMatchObject([
      { kind: "notice", label: "Rate limit", text: "Rate limit reached." },
    ]);
  });

  it("keeps every message it does not handle visible, under the agent's own name", () => {
    const { items } = mapAll([
      { type: "system", subtype: "status", status: "compacting", uuid: "u", session_id: "s" },
      { type: "tool_progress", tool_name: "Bash" },
      { type: "brand_new_type", value: 1 },
    ]);
    expect(items).toMatchObject([
      { kind: "event", name: "system/status", detail: '{"type":"system","subtype":"status","status":"compacting"}' },
      { kind: "event", name: "tool_progress" },
      { kind: "event", name: "brand_new_type" },
    ]);
  });
});

describe("result", () => {
  it("reports an error even when the subtype says success", () => {
    const { state } = mapAll([
      { type: "result", subtype: "success", is_error: true, total_cost_usd: 0, modelUsage: {} },
    ]);
    expect(state.outcome).toEqual({ status: "error", detail: "success" });
  });

  it("sums the totals of every model the agent used", () => {
    const usage = (input: number, output: number) => ({
      inputTokens: input,
      outputTokens: output,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 5,
    });
    const { state } = mapAll([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        total_cost_usd: 0.5,
        modelUsage: { main: { ...usage(100, 50), thinkingTokens: 30 }, helper: usage(20, 5) },
      },
    ]);
    expect(state.cumulative).toEqual({
      tokens: { input: 150, cacheRead: 20, cacheWrite: 10, output: 55, reasoning: 30 },
      reportedUsd: 0.5,
      // Made-up model names: no list price, so no derived cost, and the models are named.
      computedUsd: null,
      unpriced: ["main", "helper"],
      unpricedWebActions: 0,
    });
  });
});
