import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ComparisonRecord, HistoryEntry } from "@/lib/domain/types";
import { databaseUrl, dataDir } from "./config";

/**
 * Comparisons, the history of runs, and a few shared values (the agents' catalog). A SQLite file locally (built
 * into Node.js: nothing to install), Postgres when DATABASE_URL is set. The web app and the worker are separate
 * processes that both write a comparison: `update` reads, changes and writes it in one transaction, so neither
 * loses the other's change.
 */
export interface Store {
  get(id: string): Promise<ComparisonRecord | null>;
  insert(record: ComparisonRecord): Promise<void>;
  /** Applies `change` to the current record. Throws if the comparison does not exist. */
  update(id: string, change: (record: ComparisonRecord) => ComparisonRecord): Promise<ComparisonRecord>;
  appendHistory(entries: HistoryEntry[]): Promise<void>;
  /** Newest first. */
  history(limit: number): Promise<HistoryEntry[]>;
  getValue<T>(key: string): Promise<T | null>;
  setValue(key: string, value: unknown): Promise<void>;
  close(): Promise<void>;
}

const missing = (id: string) => new Error(`Comparison ${id} not found.`);

export async function openSqliteStore(file: string): Promise<Store> {
  mkdirSync(dirname(file), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file);
  // WAL lets readers work while another process writes; the timeout makes a second writer wait instead of failing.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS comparisons (id TEXT PRIMARY KEY, record TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, entry TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const read = (id: string) => {
    const row = db.prepare("SELECT record FROM comparisons WHERE id = ?").get(id) as { record: string } | undefined;
    return row ? (JSON.parse(row.record) as ComparisonRecord) : null;
  };
  const transaction = <T>(work: () => T): T => {
    // IMMEDIATE takes the write lock before reading, so two writers cannot both read the same old record.
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  return {
    async get(id) {
      return read(id);
    },
    async insert(record) {
      db.prepare("INSERT INTO comparisons (id, record, updated_at) VALUES (?, ?, ?)").run(
        record.info.id,
        JSON.stringify(record),
        new Date().toISOString(),
      );
    },
    async update(id, change) {
      return transaction(() => {
        const current = read(id);
        if (!current) throw missing(id);
        const next = change(current);
        db.prepare("UPDATE comparisons SET record = ?, updated_at = ? WHERE id = ?").run(
          JSON.stringify(next),
          new Date().toISOString(),
          id,
        );
        return next;
      });
    },
    async appendHistory(entries) {
      transaction(() => {
        for (const entry of entries) db.prepare("INSERT INTO history (entry) VALUES (?)").run(JSON.stringify(entry));
      });
    },
    async history(limit) {
      const rows = db.prepare("SELECT entry FROM history ORDER BY id DESC LIMIT ?").all(limit) as { entry: string }[];
      return rows.map((row) => JSON.parse(row.entry) as HistoryEntry);
    },
    async getValue<T>(key: string) {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
      return row ? (JSON.parse(row.value) as T) : null;
    },
    async setValue(key, value) {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ).run(key, JSON.stringify(value));
    },
    async close() {
      db.close();
    },
  };
}

export async function openPostgresStore(url: string): Promise<Store> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS comparisons (id TEXT PRIMARY KEY, record JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS history (id BIGSERIAL PRIMARY KEY, entry JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL);
  `);
  return {
    async get(id) {
      const { rows } = await pool.query("SELECT record FROM comparisons WHERE id = $1", [id]);
      return (rows[0]?.record as ComparisonRecord | undefined) ?? null;
    },
    async insert(record) {
      await pool.query("INSERT INTO comparisons (id, record) VALUES ($1, $2)", [
        record.info.id,
        JSON.stringify(record),
      ]);
    },
    async update(id, change) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // FOR UPDATE locks the row until COMMIT: a concurrent writer waits and then reads this change.
        const { rows } = await client.query("SELECT record FROM comparisons WHERE id = $1 FOR UPDATE", [id]);
        const current = rows[0]?.record as ComparisonRecord | undefined;
        if (!current) throw missing(id);
        const next = change(current);
        await client.query("UPDATE comparisons SET record = $2, updated_at = now() WHERE id = $1", [
          id,
          JSON.stringify(next),
        ]);
        await client.query("COMMIT");
        return next;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async appendHistory(entries) {
      for (const entry of entries) await pool.query("INSERT INTO history (entry) VALUES ($1)", [JSON.stringify(entry)]);
    },
    async history(limit) {
      const { rows } = await pool.query("SELECT entry FROM history ORDER BY id DESC LIMIT $1", [limit]);
      return rows.map((row) => row.entry as HistoryEntry);
    },
    async getValue<T>(key: string) {
      const { rows } = await pool.query("SELECT value FROM settings WHERE key = $1", [key]);
      return (rows[0]?.value as T | undefined) ?? null;
    },
    async setValue(key, value) {
      await pool.query(
        "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [key, JSON.stringify(value)],
      );
    },
    async close() {
      await pool.end();
    },
  };
}

const cache = globalThis as { __dyonStore?: Promise<Store> };

/** The app's store, opened once per process: Postgres if DATABASE_URL is set, else `<dataDir>/dyon.db`. */
export function store(): Promise<Store> {
  return (cache.__dyonStore ??= databaseUrl
    ? openPostgresStore(databaseUrl)
    : openSqliteStore(join(dataDir, "dyon.db")));
}
