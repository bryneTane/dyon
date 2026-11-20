import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { agentEnv, createWorkspace, openWorkspace, relativePath } from "@/lib/server/workspace";

const base = mkdtempSync(join(tmpdir(), "dyon-test-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("createWorkspace", () => {
  it("creates an empty workspace, a home and a temporary folder", async () => {
    const ws = await createWorkspace(join(base, "run-1"));
    expect(readdirSync(ws.dir)).toEqual([]);
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
