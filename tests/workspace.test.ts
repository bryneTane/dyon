import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  agentEnv,
  createWorkspace,
  markTurnStart,
  openWorkspace,
  relativePath,
  workspaceDiff,
} from "@/lib/server/workspace";

const base = mkdtempSync(join(tmpdir(), "dyon-test-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("createWorkspace", () => {
  it("creates an empty git workspace, a home and a temporary folder", async () => {
    const ws = await createWorkspace(join(base, "run-1"));
    expect(readdirSync(ws.dir)).toEqual([".git"]);
    await markTurnStart(ws);
    expect((await workspaceDiff(ws)).files).toEqual([]);
    expect(existsSync(ws.home) && existsSync(ws.tmp)).toBe(true);
  });

  it("gives every run its own folders", async () => {
    const a = await createWorkspace(join(base, "run-a"));
    const b = await createWorkspace(join(base, "run-b"));
    expect(a.dir).not.toBe(b.dir);
    expect(a.home).not.toBe(b.home);
  });

  it("reopens a workspace with the same paths", async () => {
    const ws = await createWorkspace(join(base, "run-2"));
    const again = await openWorkspace(ws.root);
    expect(again).toEqual(ws);
  });
});

describe("agentEnv", () => {
  it("passes only PATH from Dyon's environment, plus what the agent needs", async () => {
    process.env.DYON_TEST_SECRET = "must not leak";
    const ws = await createWorkspace(join(base, "run-3"));
    const env = agentEnv(ws, { ANTHROPIC_API_KEY: "k" });
    expect(Object.keys(env).sort()).toEqual(["ANTHROPIC_API_KEY", "HOME", "LANG", "PATH", "TMPDIR"]);
    expect(env.HOME).toBe(ws.home);
    expect(env.TMPDIR).toBe(ws.tmp);
    delete process.env.DYON_TEST_SECRET;
  });
});

describe("relativePath", () => {
  it("shows paths inside the workspace relative to it, and others unchanged", async () => {
    const ws = await createWorkspace(join(base, "run-4"));
    expect(relativePath(ws, join(ws.dir, "src/a.ts"))).toBe("src/a.ts");
    expect(relativePath(ws, join(ws.dirReal, "b.py"))).toBe("b.py");
    expect(relativePath(ws, ws.dir)).toBe(".");
    expect(relativePath(ws, "/etc/hosts")).toBe("/etc/hosts");
  });
});

describe("workspaceDiff", () => {
  const git = (dir: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=a", "-c", "user.email=a@b.c", ...args], { cwd: dir, encoding: "utf8" });

  it("lists what changed during the turn, committed or not, without touching the agent's git state", async () => {
    const ws = await createWorkspace(join(base, "run-5"));
    // A first turn left two files.
    writeFileSync(join(ws.dir, "kept.txt"), "one\ntwo\n");
    writeFileSync(join(ws.dir, "gone.txt"), "x\n");
    await markTurnStart(ws);
    // During this turn the agent commits a change, then edits, deletes and creates files.
    writeFileSync(join(ws.dir, "kept.txt"), "one\nthree\n");
    git(ws.dir, "add", "-A");
    git(ws.dir, "commit", "-qm", "agent commit");
    unlinkSync(join(ws.dir, "gone.txt"));
    writeFileSync(join(ws.dir, "new.js"), "a\nb\nc\n");
    writeFileSync(join(ws.dir, "img.bin"), Buffer.from([0, 1, 2, 0]));
    mkdirSync(join(ws.dir, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(ws.dir, "node_modules/pkg/index.js"), "x\n");
    const before = git(ws.dir, "status", "--porcelain");

    const diff = await workspaceDiff(ws);
    expect(diff.files).toEqual([
      { path: "gone.txt", change: "deleted", added: 0, removed: 1 },
      { path: "img.bin", change: "added", added: null, removed: null },
      { path: "kept.txt", change: "modified", added: 1, removed: 1 },
      { path: "new.js", change: "added", added: 3, removed: 0 },
    ]);
    expect(diff.patch).toContain("+three");
    expect(diff.truncated).toBe(false);
    expect(git(ws.dir, "status", "--porcelain")).toBe(before);
  });
});
