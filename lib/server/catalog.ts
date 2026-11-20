import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { query, type ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Catalog, ModelOption } from "@/lib/domain/catalog";
import { errorText } from "@/lib/domain/text";

const exec = promisify(execFile);

/** Claude Code's own list. Several entries can be aliases of one model ("default" and "opus"): kept once. */
export function claudeModelOptions(models: ModelInfo[]): ModelOption[] {
  const byId = new Map<string, ModelOption>();
  models.forEach((model, index) => {
    const id = model.resolvedModel ?? model.value;
    const known = byId.get(id);
    // The first entry is the agent's default; a later alias of the same model has the more specific name.
    if (known) {
      if (index > 0) known.label = model.displayName;
      return;
    }
    byId.set(id, { id, label: model.displayName, efforts: model.supportedEffortLevels ?? [] });
  });
  return [...byId.values()];
}

/** The fields Dyon reads from `codex debug models`, the catalog the Codex CLI itself uses. Untyped JSON: validated. */
const codexCatalog = z.object({
  models: z.array(
    z.object({
      slug: z.string(),
      display_name: z.string(),
      visibility: z.string(),
      supported_in_api: z.boolean(),
      priority: z.number(),
      supported_reasoning_levels: z.array(z.object({ effort: z.string() })),
    }),
  ),
});

/** Models Codex lists to its users and supports through the API, in Codex's own order (its default first). */
export function codexModelOptions(json: unknown): ModelOption[] {
  return codexCatalog
    .parse(json)
    .models.filter((m) => m.visibility === "list" && m.supported_in_api)
    .sort((a, b) => a.priority - b.priority)
    .map((m) => ({ id: m.slug, label: m.display_name, efforts: m.supported_reasoning_levels.map((l) => l.effort) }));
}

async function readClaudeModels(): Promise<ModelOption[]> {
  const home = await mkdtemp(join(tmpdir(), "dyon-catalog-"));
  // A session that never receives a prompt: only its model list is read.
  const idle = (async function* () {
    await new Promise(() => {});
  })();
  const session = query({
    prompt: idle as AsyncIterable<never>,
    options: {
      cwd: home,
      settingSources: [],
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: home,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
      },
    },
  });
  try {
    return claudeModelOptions(await session.supportedModels());
  } finally {
    session.close();
    await rm(home, { recursive: true, force: true });
  }
}

async function readCodexModels(): Promise<ModelOption[]> {
  const require = createRequire(import.meta.url);
  const pkg = require.resolve("@openai/codex/package.json");
  const bin = join(dirname(pkg), (require(pkg) as { bin: { codex: string } }).bin.codex);
  const home = await mkdtemp(join(tmpdir(), "dyon-catalog-"));
  try {
    // Only what the CLI needs: no user configuration and no key.
    const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, CODEX_HOME: home } as Record<string, string>;
    const { stdout } = await exec(process.execPath, [bin, "debug", "models"], {
      env: env as NodeJS.ProcessEnv,
      maxBuffer: 64 * 1024 * 1024,
    });
    return codexModelOptions(JSON.parse(stdout));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function read(load: () => Promise<ModelOption[]>): Promise<Catalog[keyof Catalog]> {
  try {
    const models = await load();
    return models.length ? { models } : { models, error: "The agent reported no models." };
  } catch (error) {
    return { models: [], error: `Could not read the agent's models: ${errorText(error)}` };
  }
}

const cache = globalThis as { __dyonCatalog?: Promise<Catalog> };

/** Both agents' models, read once per server process. */
export function loadCatalog(): Promise<Catalog> {
  cache.__dyonCatalog ??= Promise.all([read(readClaudeModels), read(readCodexModels)]).then(([claude, codex]) => ({
    claude,
    codex,
  }));
  return cache.__dyonCatalog;
}
