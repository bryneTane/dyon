// One command for the local processes: the web app (Next.js, :3000), the worker (:3001) and the live relay (:3002) that runs the turns.
// Reads the API keys from .env.local, creates the secret they share on first run, and prefixes each one's output.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DYON_DATA_DIR || join(root, ".dyon");
mkdirSync(dataDir, { recursive: true });
if (existsSync(join(root, ".env.local"))) process.loadEnvFile(join(root, ".env.local"));
for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"])
  if (!process.env[key]) console.warn(`[dev] ${key} is not set in .env.local: that agent's runs will fail.`);

// Generated once and kept: the web app and the worker must agree on it.
const secretsFile = join(dataDir, "dev-secrets.json");
const secrets = existsSync(secretsFile) ? JSON.parse(readFileSync(secretsFile, "utf8")) : {};
secrets.worker ??= randomBytes(32).toString("hex");
secrets.relay ??= randomBytes(32).toString("hex");
writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
// The relay reads its secret from party/.dev.vars, as `wrangler secret put` sets it once deployed.
writeFileSync(join(root, "party", ".dev.vars"), `PARTYKIT_SECRET=${secrets.relay}\n`, { mode: 0o600 });

const env = {
  ...process.env,
  DYON_DATA_DIR: dataDir,
  WORKER_URL: "http://localhost:3001",
  WORKER_SECRET: secrets.worker,
  RELAY_URL: "http://localhost:3002",
  RELAY_SECRET: secrets.relay,
  NODE_NO_WARNINGS: "1", // node:sqlite prints an experimental warning on every start
};

// The worker is not restarted on file changes: a restart would cut its running turns short. Restart
// `npm run dev` to load worker changes.
const processes = [
  { name: "web", color: 36, args: ["next", "dev"] },
  { name: "worker", color: 33, args: ["tsx", "--conditions=react-server", "worker/server.ts"] },
  { name: "relay", color: 35, args: ["wrangler", "dev", "--port", "3002", "--cwd", "party"] },
];
const children = processes.map(({ name, color, args }) => {
  const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", args, {
    cwd: root,
    env: name === "relay" ? process.env : { ...env, PORT: name === "worker" ? "3001" : "3000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `\x1b[${color}m${name.padEnd(6)}\x1b[0m│ `;
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream.on("data", (chunk) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(`${prefix}${line}\n`);
    });
  }
  child.on("exit", (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 1);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
console.log("[dev] Dyon on http://localhost:3000 (worker on :3001, live relay on :3002)");
