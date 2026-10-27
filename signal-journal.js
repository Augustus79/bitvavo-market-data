// Bounded, lossless signal journal. One local writer; Git publishes the whole transaction.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

export const JOURNAL_PART_BYTES = 16 * 1024 * 1024;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const partName = (n) => `${String(n).padStart(6, "0")}.jsonl`;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

function locations(dir, month) {
  if (!monthPattern.test(month)) throw new Error("Invalid journal month");
  const folder = path.join(dir, `signals-${month}`);
  return { folder, manifest: path.join(folder, "manifest.json"), legacy: path.join(dir, `signals-${month}.jsonl`) };
}

function atomicWrite(file, bytes) {
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function saveManifest(file, manifest) {
  atomicWrite(file, JSON.stringify(manifest, null, 2) + "\n");
}

function readManifest(loc) {
  const m = JSON.parse(fs.readFileSync(loc.manifest, "utf8"));
  if (m.schemaVersion !== 1 || !Array.isArray(m.sealed) ||
      !Number.isSafeInteger(m.activePart) || m.activePart < 1 || m.activePart !== m.sealed.length + 1) {
    throw new Error("Invalid journal manifest");
  }
  for (const [i, p] of m.sealed.entries()) {
    if (p.file !== `${partName(i + 1)}.gz` || !fs.existsSync(path.join(loc.folder, p.file))) {
      throw new Error("Missing or invalid sealed journal part");
    }
  }
  if (!fs.existsSync(path.join(loc.folder, partName(m.activePart)))) throw new Error("Missing active journal part");
  return m;
}

function records(bytes) {
  return bytes.toString("utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  });
}

function seal(folder, n, bytes) {
  const file = `${partName(n)}.gz`;
  const compressed = gzipSync(bytes, { level: 6 });
  if (compressed.length >= 32 * 1024 * 1024) throw new Error("Compressed journal part exceeds safety limit");
  // Verify before publishing the manifest or removing any source bytes.
  const sha256 = hash(bytes);
  if (hash(gunzipSync(compressed)) !== sha256) throw new Error("Journal compression verification failed");
  const times = records(bytes).map((r) => Date.parse(r?.snapshotCollectedAt)).filter(Number.isFinite);
  atomicWrite(path.join(folder, file), compressed);
  return { file, bytes: bytes.length, sha256, endsWithNewline: bytes.at(-1) === 10,
    minSnapshotMs: times.length ? times.reduce((a, b) => Math.min(a, b)) : null,
    maxSnapshotMs: times.length ? times.reduce((a, b) => Math.max(a, b)) : null };
}

function readSealed(loc, part) {
  const bytes = gunzipSync(fs.readFileSync(path.join(loc.folder, part.file)));
  if (bytes.length !== part.bytes || hash(bytes) !== part.sha256) throw new Error(`Corrupt journal part: ${part.file}`);
  return bytes;
}

function splitAtLines(bytes, limit) {
  const parts = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + limit, bytes.length);
    if (end < bytes.length) end = bytes.lastIndexOf(10, end - 1) + 1;
    if (end <= start) throw new Error("A journal record exceeds the part size limit");
    parts.push(bytes.subarray(start, end));
    start = end;
  }
  return parts;
}

// Remove only files absent from the committed manifest: a failed Git push/reset or
// interrupted rollover may have left untracked parts from an abandoned attempt.
function cleanup(loc, m) {
  const keep = new Set([partName(m.activePart), ...m.sealed.map((p) => p.file)]);
  for (const file of fs.readdirSync(loc.folder)) {
    if (file === "manifest.json.tmp") { fs.unlinkSync(path.join(loc.folder, file)); continue; }
    if (/^\d{6,}\.jsonl(?:\.gz)?(?:\.tmp)?$/.test(file) && !keep.has(file)) fs.unlinkSync(path.join(loc.folder, file));
  }
  if (fs.existsSync(loc.legacy)) {
    const source = fs.readFileSync(loc.legacy);
    if (!m.legacy || source.length !== m.legacy.bytes || hash(source) !== m.legacy.sha256) {
      throw new Error("Legacy journal changed after migration; refusing to remove it");
    }
    // Recheck archived bytes on recovery before deleting the legacy source.
    const migratedHash = createHash("sha256");
    let size = 0;
    for (const p of m.sealed.slice(0, m.legacy.parts)) {
      const bytes = readSealed(loc, p); migratedHash.update(bytes); size += bytes.length;
    }
    if (size !== source.length || migratedHash.digest("hex") !== m.legacy.sha256) throw new Error("Legacy migration is incomplete");
    fs.unlinkSync(loc.legacy);
  }
}

function ensureMonth(dir, month, limit) {
  const loc = locations(dir, month);
  fs.mkdirSync(loc.folder, { recursive: true });
  if (!fs.existsSync(loc.manifest)) {
    const source = fs.existsSync(loc.legacy) ? fs.readFileSync(loc.legacy) : Buffer.alloc(0);
    const chunks = splitAtLines(source, limit);
    const sealed = chunks.map((bytes, i) => seal(loc.folder, i + 1, bytes));
    const m = { schemaVersion: 1, month, sealed, activePart: sealed.length + 1,
      legacy: fs.existsSync(loc.legacy) ? { bytes: source.length, sha256: hash(source), parts: sealed.length } : null };
    atomicWrite(path.join(loc.folder, partName(m.activePart)), Buffer.alloc(0));
    saveManifest(loc.manifest, m);
  }
  const m = readManifest(loc);
  cleanup(loc, m);
  return { loc, m };
}

export function migrateLegacySignalJournals({ dir = "history", maxBytes = JOURNAL_PART_BYTES } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const migrated = [];
  for (const file of fs.readdirSync(dir).sort()) {
    const match = /^signals-(\d{4}-\d{2})\.jsonl$/.exec(file);
    if (!match) continue;
    ensureMonth(dir, match[1], maxBytes);
    migrated.push(file);
  }
  return migrated;
}

export function appendSignalRecord(record, { dir = "history", maxBytes = JOURNAL_PART_BYTES } = {}) {
  const key = record.snapshotCollectedAt;
  const ms = Date.parse(key);
  if (typeof key !== "string" || !Number.isFinite(ms)) throw new Error("Invalid snapshotCollectedAt; refusing to journal");
  let line = Buffer.from(JSON.stringify(record) + "\n");
  if (line.length > maxBytes) throw new Error("A journal record exceeds the part size limit");
  const { loc, m } = ensureMonth(dir, key.slice(0, 7), maxBytes);
  let file = path.join(loc.folder, partName(m.activePart));
  const active = fs.readFileSync(file);
  const contains = (bytes) => records(bytes).some((r) => r?.snapshotCollectedAt === key);
  // Normal forward collection reads only the bounded active part. Replays also
  // check any sealed part whose timestamp range could contain the exact key.
  if (contains(active) || m.sealed.some((p) => p.minSnapshotMs !== null && ms >= p.minSnapshotMs && ms <= p.maxSnapshotMs && contains(readSealed(loc, p)))) {
    return { file, appended: false };
  }
  if (active.length && active.at(-1) !== 10) throw new Error("Active journal has an incomplete final line");
  if (!active.length && m.sealed.length && !m.sealed.at(-1).endsWithNewline) line = Buffer.concat([Buffer.from("\n"), line]);
  if (line.length > maxBytes) throw new Error("A journal record exceeds the part size limit");
  if (active.length + line.length <= maxBytes) {
    atomicWrite(file, Buffer.concat([active, line]));
  } else {
    const sealed = seal(loc.folder, m.activePart, active);
    const next = { ...m, sealed: [...m.sealed, sealed], activePart: m.activePart + 1 };
    file = path.join(loc.folder, partName(next.activePart));
    atomicWrite(file, line);
    saveManifest(loc.manifest, next);
    cleanup(loc, next);
  }
  return { file, appended: true };
}

// Lossless export, including legacy months not yet migrated; no state mutation.
export function* readSignalJournal(month, { dir = "history" } = {}) {
  const loc = locations(dir, month);
  if (!fs.existsSync(loc.manifest)) {
    if (fs.existsSync(loc.legacy)) yield fs.readFileSync(loc.legacy);
    return;
  }
  const m = readManifest(loc);
  for (const part of m.sealed) yield readSealed(loc, part);
  yield fs.readFileSync(path.join(loc.folder, partName(m.activePart)));
}
