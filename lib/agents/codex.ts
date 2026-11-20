import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Codex, type ModelReasoningEffort, type ThreadOptions } from "@openai/codex-sdk";
import type { CompetitorSpec } from "@/lib/domain/types";
import { errorText } from "@/lib/domain/text";
import { codexPackageDir } from "@/lib/server/config";
import { agentEnv, relativePath, type Workspace } from "@/lib/server/workspace";
import { createCodexMapper } from "./codex-map";
import type { AgentSession, TurnReport } from "./session";

/** The version of the Codex CLI the SDK runs. Codex reports no version in its events. */
const codexVersion = (JSON.parse(readFileSync(join(codexPackageDir, "package.json"), "utf8")) as { version: string })
  .version;

/** The client Dyon runs Codex with. Exported so recordings use exactly the same settings. */
export function codexClient(ws: Workspace): Codex {
  // Codex refuses to start when CODEX_HOME does not exist.
  const codexHome = join(ws.home, ".codex");
  mkdirSync(codexHome, { recursive: true });
  return new Codex({
    apiKey: process.env.OPENAI_API_KEY ?? "",
    env: agentEnv(ws, { CODEX_HOME: codexHome }),
    // Without this, each run's Codex home grew to 97 MB (95 MB in .tmp); with it, 2.4 MB (measured 2026-11-20).
    config: { features: { plugins: false } },
  });
}

/** The thread settings Dyon runs Codex with. */
export function codexThreadOptions(ws: Workspace, spec: CompetitorSpec): ThreadOptions {
  return {
    workingDirectory: ws.dir,
    model: spec.model,
    // Checked against the efforts this model reports (lib/domain/catalog.ts) before a run starts.
    ...(spec.effort ? { modelReasoningEffort: spec.effort as ModelReasoningEffort } : {}),
    // Workspaces are plain folders, not git repositories.
    skipGitRepoCheck: true,
    // Runs unattended, like any automated use: no approval prompts.
    approvalPolicy: "never",
    sandboxMode: "workspace-write",
    // Commands reach the network, as Claude Code's do.
    networkAccessEnabled: true,
  };
}

/** Codex through the Codex SDK. Follow-ups resume the same thread. */
export function createCodexSession(ws: Workspace, spec: CompetitorSpec, threadId?: string): AgentSession {
  const codex = codexClient(ws);
  const thread = threadId
    ? codex.resumeThread(threadId, codexThreadOptions(ws, spec))
    : codex.startThread(codexThreadOptions(ws, spec));

  return {
    spec,
    workspace: ws,
    state: () => (thread.id ? { threadId: thread.id } : null),
    async send(prompt, emit, signal) {
      const mapper = createCodexMapper({ rel: (p) => relativePath(ws, p), newId: randomUUID });
      let outcome: TurnReport["outcome"] = { status: "error", detail: "The agent ended without a result." };
      try {
        const { events } = await thread.runStreamed(prompt, { signal });
        for await (const event of events) for (const item of mapper.map(event)) emit(item);
        outcome = mapper.state.outcome ?? outcome;
      } catch (error) {
        if (signal.aborted) outcome = { status: "aborted" };
        else {
          outcome = { status: "error", detail: errorText(error) };
          emit({ id: randomUUID(), kind: "error", text: errorText(error) });
        }
      }
      return { outcome, cumulative: mapper.state.cumulative ?? null, version: codexVersion };
    },
  };
}
