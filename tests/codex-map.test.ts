import { readFileSync } from "node:fs";
import type { ThreadEvent } from "@openai/codex-sdk";
import { describe, expect, it } from "vitest";
import { createCodexMapper } from "@/lib/agents/codex-map";
import type { TimelineItem } from "@/lib/domain/types";

function mapAll(events: unknown[]) {
  let n = 0;
  const m = createCodexMapper({ rel: (p) => p.replace(/^\/run\/workspace\//, ""), newId: () => `id-${++n}` });
  return { items: events.flatMap((e) => m.map(e as ThreadEvent)), state: m.state };
}

describe("a recorded run: Create hello.py that prints Hello and run it", () => {
  const recorded = readFileSync(new URL("./fixtures/codex-hello.jsonl", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const { items, state } = mapAll(recorded);

  it("shows each command running then finished under one id, between the agent's messages", () => {
    expect(items.map((i) => `${i.kind}:${i.status ?? ""}`)).toEqual([
      "message:",
      "command:running",
      "command:ok",
      "command:running",
      "command:ok",
      "command:running",
      "command:ok",
      "message:",
    ]);
    expect(items[1].id).toBe(items[2].id);
    const created = items[4] as Extract<TimelineItem, { kind: "command" }>;
    expect(created.command).toContain("hello.py");
    expect(created.exitCode).toBe(0);
  });

  it("keeps the thread id and the running totals Codex reported", () => {
    expect(state.threadId).toBeTruthy();
    expect(state.outcome).toEqual({ status: "completed" });
    const t = state.cumulative!.tokens;
    expect(t.input).toBeGreaterThanOrEqual(t.cacheRead + t.cacheWrite);
    expect(t.output).toBeGreaterThan(0);
    expect(state.cumulative!.reportedUsd).toBeNull();
  });
});

// Hand-written events for cases the recorded run does not contain. Their names and fields are the SDK's
// (see its dist/index.d.ts); the converter itself is type-checked against them.
const completed = (item: object) => ({ type: "item.completed", item });

describe("items", () => {
  it("maps file changes, web searches, tool calls and failures to their own kinds", () => {
    const { items } = mapAll([
      completed({
        id: "1",
        type: "file_change",
        status: "completed",
        changes: [{ path: "/run/workspace/a.py", kind: "add" }],
      }),
      { type: "item.started", item: { id: "2", type: "web_search", query: "vitest docs" } },
      completed({
        id: "3",
        type: "mcp_tool_call",
        server: "docs",
        tool: "search",
        arguments: { q: 1 },
        status: "failed",
        error: { message: "down" },
      }),
      completed({
        id: "4",
        type: "command_execution",
        command: "false",
        aggregated_output: "",
        exit_code: 1,
        status: "failed",
      }),
      completed({ id: "5", type: "error", message: "Something went wrong." }),
    ]);
    expect(items).toMatchObject([
      { kind: "file_edit", tool: "patch", files: [{ path: "a.py", change: "add" }], status: "ok" },
      { kind: "web_search", query: "vitest docs", status: "running" },
      { kind: "tool", name: "docs.search", input: '{"q":1}', status: "failed", output: "down" },
      { kind: "command", exitCode: 1, status: "failed" },
      { kind: "error", text: "Something went wrong." },
    ]);
  });

  it("shows the agent's plan as a notice", () => {
    const { items } = mapAll([
      completed({
        id: "1",
        type: "todo_list",
        items: [
          { text: "Write it", completed: true },
          { text: "Run it", completed: false },
        ],
      }),
    ]);
    expect(items).toMatchObject([{ kind: "notice", label: "Plan", text: "[x] Write it\n[ ] Run it" }]);
  });

  it("keeps anything it does not handle visible, under Codex's own name", () => {
    const { items } = mapAll([{ type: "brand.new", value: 1 }, completed({ id: "1", type: "brand_new_item" })]);
    expect(items).toMatchObject([
      { kind: "event", name: "brand.new" },
      { kind: "event", name: "item/brand_new_item" },
    ]);
  });
});

describe("end of turn", () => {
  it("reports a failed turn with its message", () => {
    const { items, state } = mapAll([{ type: "turn.failed", error: { message: "Quota exceeded." } }]);
    expect(state.outcome).toEqual({ status: "error", detail: "Quota exceeded." });
    expect(items).toMatchObject([{ kind: "error", text: "Quota exceeded." }]);
  });

  it("reads the totals with cache reads and writes inside the input", () => {
    const usage = {
      input_tokens: 100,
      cached_input_tokens: 60,
      cache_write_input_tokens: 30,
      output_tokens: 20,
      reasoning_output_tokens: 5,
    };
    const { state } = mapAll([{ type: "turn.completed", usage }]);
    expect(state.cumulative?.tokens).toEqual({ input: 100, cacheRead: 60, cacheWrite: 30, output: 20, reasoning: 5 });
  });
});
