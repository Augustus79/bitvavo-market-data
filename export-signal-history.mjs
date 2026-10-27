import fs from "node:fs";
import { readSignalJournal } from "./signal-journal.js";

if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(process.argv[2] ?? "")) {
  throw new Error("Usage: node export-signal-history.mjs YYYY-MM > /path/outside/history/export.jsonl");
}
for (const bytes of readSignalJournal(process.argv[2])) fs.writeSync(1, bytes);
