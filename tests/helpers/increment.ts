// Run as a separate process by tests/store.test.ts: increments a record's seq many times in the given store.
import { openStore } from "@/lib/server/store";

const [file, id, times] = process.argv.slice(2);
const store = openStore(file);
for (let i = 0; i < Number(times); i++) store.update(id, (r) => ({ ...r, seq: r.seq + 1 }));
store.close();
