import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ComparisonRecord, HistoryEntry } from "@/lib/domain/types";
import { dataDir } from "./config";

/** Comparisons and the history of runs, in one SQLite file. Built into Node.js: nothing to install or start. */
export interface Store {
  get(id: string): ComparisonRecord | null;
  insert(record: ComparisonRecord): void;
  /** Reads, changes and writes a record in one transaction, so concurrent writers never lose an update. */
  update(id: string, change: (record: ComparisonRecord) => ComparisonRecord): ComparisonRecord;
  appendHistory(entries: HistoryEntry[]): void;
  /** Newest first. */
  history(limit: number): HistoryEntry[];
  close(): void;
}

export function openStore(file: string): Store {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL lets readers work while a turn writes; the timeout makes a second writer wait instead of failing.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS comparisons (id TEXT PRIMARY KEY, record TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, entry TEXT NOT NULL);
  `);
  const select = db.prepare("SELECT record FROM comparisons WHERE id = ?");
  const insert = db.prepare("INSERT INTO comparisons (id, record, updated_at) VALUES (?, ?, ?)");
  const write = db.prepare("UPDATE comparisons SET record = ?, updated_at = ? WHERE id = ?");
  const addHistory = db.prepare("INSERT INTO history (entry) VALUES (?)");
  const recent = db.prepare("SELECT entry FROM history ORDER BY id DESC LIMIT ?");
  const read = (id: string) => {
    const row = select.get(id) as { record: string } | undefined;
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
    get: read,
    insert(record) {
      insert.run(record.info.id, JSON.stringify(record), new Date().toISOString());
    },
    update(id, change) {
      return transaction(() => {
        const current = read(id);
        if (!current) throw new Error(`Comparison ${id} not found.`);
        const next = change(current);
        write.run(JSON.stringify(next), new Date().toISOString(), id);
        return next;
      });
    },
    appendHistory(entries) {
      transaction(() => {
        for (const entry of entries) addHistory.run(JSON.stringify(entry));
      });
    },
    history(limit) {
      return (recent.all(limit) as { entry: string }[]).map((row) => JSON.parse(row.entry) as HistoryEntry);
    },
    close() {
      db.close();
    },
  };
}

const cache = globalThis as { __dyonStore?: Store };

/** The app's store at `<dataDir>/dyon.db`, opened once per server process. */
export function store(): Store {
  return (cache.__dyonStore ??= openStore(join(dataDir, "dyon.db")));
}
