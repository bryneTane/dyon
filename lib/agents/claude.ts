import "server-only";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { query, type EffortLevel, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { CompetitorSpec } from "@/lib/domain/types";
import { errorText } from "@/lib/domain/text";
import { agentEnv, relativePath, type Workspace } from "@/lib/server/workspace";
import { createClaudeMapper } from "./claude-map";
import type { AgentSession, TurnReport } from "./session";

/** The options Dyon runs Claude Code with. Exported so recordings use exactly the same ones. */
export function claudeOptions(
  ws: Workspace,
  spec: CompetitorSpec,
  resume: string | undefined,
  abortController: AbortController,
  apiKey = process.env.ANTHROPIC_API_KEY ?? "",
): Options {
  return {
    cwd: ws.dir,
    resume,
    model: spec.model,
    ...(spec.effort ? { effort: spec.effort as EffortLevel } : {}),
    abortController,
    // No user, project or local settings from the developer's machine.
    settingSources: [],
    // Runs unattended, like any automated use: no approval prompts.
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: 50,
    maxBudgetUsd: 5,
    env: agentEnv(ws, {
      ANTHROPIC_API_KEY: apiKey,
      // Where Claude Code keeps its configuration and transcripts (named in the SDK's own type docs): one per run.
      CLAUDE_CONFIG_DIR: join(ws.home, ".claude"),
    }),
  };
}

/** Claude Code through the Claude Agent SDK. Follow-ups resume the same session. */
export function createClaudeSession(
  ws: Workspace,
  spec: CompetitorSpec,
  apiKey: string,
  sessionId?: string,
): AgentSession {
  let current = sessionId;

  return {
    spec,
    workspace: ws,
    state: () => (current ? { sessionId: current } : null),
    async send(prompt, emit, signal) {
      const mapper = createClaudeMapper({ rel: (p) => relativePath(ws, p), newId: randomUUID });
      const abortController = new AbortController();
      const abort = () => abortController.abort();
      signal.addEventListener("abort", abort, { once: true });
      let outcome: TurnReport["outcome"] = { status: "error", detail: "The agent ended without a result." };
      try {
        for await (const message of query({
          prompt,
          options: claudeOptions(ws, spec, current, abortController, apiKey),
        })) {
          for (const item of mapper.map(message)) emit(item);
        }
        outcome = mapper.state.outcome ?? outcome;
      } catch (error) {
        if (signal.aborted) outcome = { status: "aborted" };
        else {
          outcome = { status: "error", detail: errorText(error) };
          emit({ id: randomUUID(), kind: "error", text: errorText(error) });
        }
      } finally {
        signal.removeEventListener("abort", abort);
        for (const item of mapper.finish()) emit(item);
      }
      current = mapper.state.sessionId ?? current;
      return {
        outcome,
        cumulative: mapper.state.cumulative ?? null,
        model: mapper.state.model,
        version: mapper.state.version,
      };
    },
  };
}
