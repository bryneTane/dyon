// Records the raw messages of one real agent run as a test fixture, with local paths replaced by placeholders.
// Usage: npm run record -- claude tests/fixtures/claude-hello.jsonl "Create hello.py that prints Hello and run it"

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeOptions } from "@/lib/agents/claude";
import { defaultCompetitors } from "@/lib/domain/catalog";
import { loadCatalog } from "@/lib/server/catalog";
import { createWorkspace } from "@/lib/server/workspace";

const [vendor, out, prompt] = process.argv.slice(2);
if (vendor !== "claude" || !out || !prompt) {
  console.error('Usage: npm run record -- claude <output.jsonl> "<prompt>"');
  process.exit(1);
}

const root = await mkdtemp(join(tmpdir(), "dyon-record-"));
const ws = await createWorkspace(root);
const spec = defaultCompetitors(await loadCatalog()).find((c) => c.vendor === vendor)!;
const lines: string[] = [];
for await (const message of query({ prompt, options: claudeOptions(ws, spec, undefined, new AbortController()) })) {
  lines.push(JSON.stringify(message));
}

// Claude Code also names folders after the workspace path, with "/" and "." turned into "-".
const encoded = (path: string) => path.replace(/[/.]/g, "-");
const placeholders: [string, string][] = [
  [encoded(ws.dirReal), "-run-workspace"],
  [ws.dirReal, "/run/workspace"],
  [ws.dir, "/run/workspace"],
  [ws.home, "/run/home"],
  [homedir(), "/home/user"],
];
let text = lines.join("\n") + "\n";
for (const [path, placeholder] of placeholders) text = text.split(path).join(placeholder);
await writeFile(out, text);
await rm(root, { recursive: true, force: true });
console.log(`${lines.length} messages written to ${out}`);
