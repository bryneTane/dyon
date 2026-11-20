// Records the raw messages of one real agent run as a test fixture, with local paths replaced by placeholders.
// Usage: npm run record -- <claude|codex> <output.jsonl> "<prompt>"

import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeOptions } from "@/lib/agents/claude";
import { codexClient, codexThreadOptions } from "@/lib/agents/codex";
import { defaultCompetitors } from "@/lib/domain/catalog";
import { loadCatalog } from "@/lib/server/catalog";
import { createWorkspace } from "@/lib/server/workspace";

const [vendor, out, prompt] = process.argv.slice(2);
if ((vendor !== "claude" && vendor !== "codex") || !out || !prompt) {
  console.error('Usage: npm run record -- <claude|codex> <output.jsonl> "<prompt>"');
  process.exit(1);
}

const root = await mkdtemp(join(tmpdir(), "dyon-record-"));
const ws = await createWorkspace(root);
const spec = defaultCompetitors(await loadCatalog()).find((c) => c.vendor === vendor)!;
const lines: string[] = [];
if (vendor === "claude") {
  for await (const message of query({ prompt, options: claudeOptions(ws, spec, undefined, new AbortController()) })) {
    lines.push(JSON.stringify(message));
  }
} else {
  const { events } = await codexClient(ws).startThread(codexThreadOptions(ws, spec)).runStreamed(prompt);
  for await (const event of events) lines.push(JSON.stringify(event));
}

// Claude Code also names folders after the workspace path, with "/" and "." turned into "-".
const encoded = (path: string) => path.replace(/[/.]/g, "-");
const placeholders: [string, string][] = [
  [encoded(ws.dirReal), "-run-workspace"],
  [ws.dirReal, "/run/workspace"],
  [ws.dir, "/run/workspace"],
  [ws.home, "/run/home"],
  [homedir(), "/home/user"],
  // The system temporary folder, which tools such as Xcode's python3 shim use whatever TMPDIR says.
  [await realpath(tmpdir()), "/system-tmp"],
  [tmpdir(), "/system-tmp"],
];
let text = lines.join("\n") + "\n";
for (const [path, placeholder] of placeholders) text = text.split(path).join(placeholder);
await writeFile(out, text);
await rm(root, { recursive: true, force: true });
console.log(`${lines.length} messages written to ${out}`);
