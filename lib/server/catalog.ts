import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { query, type ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Catalog, ModelOption } from "@/lib/domain/catalog";
import { errorText } from "@/lib/domain/text";
import { codexPackageDir } from "./config";

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

/**
 * Deletes a temporary folder without ever failing the read: a closed agent process can still be writing to
 * it for a moment (seen: ENOTEMPTY), which must not discard a model list that was read successfully.
 */
async function removeQuietly(dir: string) {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch((error) =>
    console.error(`Could not remove ${dir}:`, error),
  );
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
    await removeQuietly(home);
  }
}

async function readCodexModels(): Promise<ModelOption[]> {
  const pkg = JSON.parse(await readFile(join(codexPackageDir, "package.json"), "utf8")) as { bin: { codex: string } };
  const bin = join(codexPackageDir, pkg.bin.codex);
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
    await removeQuietly(home);
  }
}

async function read(load: () => Promise<ModelOption[]>): Promise<Catalog[keyof Catalog]> {
  try {
    const models = await load();
    return models.length ? { models } : { models, error: "The agent reported no models." };
  } catch (error) {
    console.error("Could not read an agent's models:", error);
    return { models: [], error: `Could not read the agent's models: ${errorText(error)}` };
  }
}

const cache = globalThis as { __dyonCatalog?: Promise<Catalog> };

/** Both agents' models, read once per server process. A catalog with an error is read again on the next call. */
export function loadCatalog(): Promise<Catalog> {
  const cached = cache.__dyonCatalog;
  if (cached) return cached;
  const loading = Promise.all([read(readClaudeModels), read(readCodexModels)]).then(([claude, codex]) => {
    const catalog: Catalog = { claude, codex };
    if (claude.error || codex.error) cache.__dyonCatalog = undefined;
    return catalog;
  });
  cache.__dyonCatalog = loading;
  return loading;
}
