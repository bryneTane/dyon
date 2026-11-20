import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ComparisonRecord, HistoryEntry } from "@/lib/domain/types";
import { openStore } from "@/lib/server/store";

const tempFile = () => join(mkdtempSync(join(tmpdir(), "dyon-store-")), "dyon.db");

function record(id: string): ComparisonRecord {
  return {
    info: { id, competitors: [], repeats: 1, check: null, blind: false, runs: [] },
    createdAt: "2026-11-20T00:00:00.000Z",
    status: "idle",
    stopRequested: false,
    seq: 0,
    meta: {},
    runs: {},
    turns: [],
    verdict: null,
  };
}

const entry = (prompt: string): HistoryEntry => ({
  at: "2026-11-20T00:00:00.000Z",
  comparisonId: "c",
  turnIndex: 0,
  prompt,
  vendor: "claude",
  requestedModel: "m",
  effort: null,
  check: null,
  runIndex: 1,
  model: null,
  wallMs: 1,
  tokens: null,
  costUsd: null,
  outcome: "completed",
  checkPassed: null,
});

describe("store", () => {
  it("returns what was inserted, and null for an unknown id", () => {
    const store = openStore(tempFile());
    store.insert(record("a"));
    expect(store.get("a")).toEqual(record("a"));
    expect(store.get("nope")).toBeNull();
  });

  it("keeps records across reopening the file", () => {
    const file = tempFile();
    const first = openStore(file);
    first.insert(record("a"));
    first.close();
    expect(openStore(file).get("a")?.info.id).toBe("a");
  });

  it("updates a record and returns the new version", () => {
    const store = openStore(tempFile());
    store.insert(record("a"));
    expect(store.update("a", (r) => ({ ...r, status: "busy" })).status).toBe("busy");
    expect(store.get("a")?.status).toBe("busy");
  });

  it("leaves the record unchanged when the change throws", () => {
    const store = openStore(tempFile());
    store.insert(record("a"));
    expect(() =>
      store.update("a", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(store.get("a")).toEqual(record("a"));
    // The failed transaction was rolled back: the next one works.
    expect(store.update("a", (r) => ({ ...r, seq: 1 })).seq).toBe(1);
  });

  it("fails to update an unknown record", () => {
    expect(() => openStore(tempFile()).update("nope", (r) => r)).toThrow("not found");
  });

  it("lists history newest first, up to the limit", () => {
    const store = openStore(tempFile());
    store.appendHistory([entry("1"), entry("2")]);
    store.appendHistory([entry("3")]);
    expect(store.history(2).map((e) => e.prompt)).toEqual(["3", "2"]);
  });

  it("loses no update when two processes update the same record at the same time", async () => {
    const file = tempFile();
    const store = openStore(file);
    store.insert(record("a"));
    const run = () =>
      new Promise<number>((resolve, reject) => {
        const child = spawn(
          "npx",
          ["tsx", "--conditions=react-server", "tests/helpers/increment.ts", file, "a", "200"],
          { stdio: "inherit" },
        );
        child.on("exit", (code) => (code === 0 ? resolve(code) : reject(new Error(`exit ${code}`))));
      });
    await Promise.all([run(), run()]);
    expect(store.get("a")?.seq).toBe(400);
  }, 30_000);
});
