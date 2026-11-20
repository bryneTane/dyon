import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createWorkspace, runCheck } from "@/lib/server/workspace";

const base = mkdtempSync(join(tmpdir(), "dyon-check-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const never = new AbortController().signal;

describe("runCheck", () => {
  it("passes on exit code 0, in the workspace", async () => {
    const ws = await createWorkspace(join(base, "pass"));
    const result = await runCheck(ws, "echo hi > out.txt && cat out.txt", never);
    expect(result).toMatchObject({ passed: true, exitCode: 0, timedOut: false, output: "hi" });
  });

  it("fails with the command's exit code, and keeps the end of a long output", async () => {
    const ws = await createWorkspace(join(base, "fail"));
    const result = await runCheck(ws, "for i in $(seq 1 3000); do echo line $i; done; exit 3", never);
    expect(result).toMatchObject({ passed: false, exitCode: 3, timedOut: false });
    expect(result.output.endsWith("line 3000")).toBe(true);
    expect(result.output).toMatch(/^\[\d[\d,]* characters omitted\]/);
  });

  it("stops at the time limit", async () => {
    const ws = await createWorkspace(join(base, "slow"));
    const result = await runCheck(ws, "sleep 5", never, 200);
    expect(result).toMatchObject({ passed: false, timedOut: true });
    expect(result.durationMs).toBeLessThan(3000);
  });

  it("sees none of Dyon's own environment", async () => {
    process.env.DYON_TEST_SECRET = "x";
    const ws = await createWorkspace(join(base, "env"));
    const result = await runCheck(ws, 'test -z "$DYON_TEST_SECRET"', never);
    delete process.env.DYON_TEST_SECRET;
    expect(result.passed).toBe(true);
  });
});
