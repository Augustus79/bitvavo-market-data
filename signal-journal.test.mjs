import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { appendSignalRecord, migrateLegacySignalJournals, readSignalJournal } from "./signal-journal.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "signal-journal-test-"));
const row = (n, month = "2026-10") => ({ snapshotCollectedAt: `${month}-01T00:${String(n).padStart(2, "0")}:00.000Z`, label: "é 🚀", value: n });
const encode = (r) => JSON.stringify(r) + "\n";
const exported = (dir, month = "2026-10") => Buffer.concat([...readSignalJournal(month, { dir })]);
const setup = (name) => { const dir = path.join(root, name); fs.mkdirSync(dir); return { dir, maxBytes: 200 }; };
const folder = (o) => path.join(o.dir, "signals-2026-10");
const manifestPath = (o) => path.join(folder(o), "manifest.json");
const manifest = (o) => JSON.parse(fs.readFileSync(manifestPath(o)));
const part = (n) => `${String(n).padStart(6, "0")}.jsonl`;

// Fail one atomic replacement, before or after rename, to simulate interruption.
function interruptRename(target, after, action) {
  const original = fs.renameSync;
  let fired = false;
  fs.renameSync = (from, to) => {
    if (!fired && to === target) {
      fired = true;
      if (after) original(from, to);
      throw new Error("simulated interruption");
    }
    return original(from, to);
  };
  try { assert.throws(action, /simulated interruption/); assert.ok(fired); }
  finally { fs.renameSync = original; }
}

try {
  const o = setup("legacy");
  // Include CRLF, a blank line and an invalid historical line: preserve all bytes.
  const original = Buffer.from(encode(row(0)).replace("\n", "\r\n") + "\ninvalid historical row\n" + encode(row(1)) + encode(row(2)));
  const legacy = path.join(o.dir, "signals-2026-10.jsonl");
  fs.writeFileSync(legacy, original);
  assert.deepEqual(exported(o.dir), original);
  migrateLegacySignalJournals(o);
  assert.ok(!fs.existsSync(legacy));
  assert.deepEqual(exported(o.dir), original);
  assert.equal(appendSignalRecord(row(1), o).appended, false); // replay in a sealed archive
  assert.equal(appendSignalRecord(row(3), o).appended, true);
  assert.equal(appendSignalRecord(row(3), o).appended, false);
  assert.deepEqual(exported(o.dir), Buffer.concat([original, Buffer.from(encode(row(3)))]));
  for (let n = 4; n < 15; n++) appendSignalRecord(row(n), o);
  const complete = Buffer.concat([original, Buffer.from(Array.from({ length: 12 }, (_, i) => encode(row(i + 3))).join(""))]);
  assert.deepEqual(exported(o.dir), complete);
  const m = manifest(o);
  assert.ok(m.sealed.length > 2);
  for (const p of m.sealed) assert.ok(gunzipSync(fs.readFileSync(path.join(folder(o), p.file))).length <= o.maxBytes);
  assert.ok(fs.statSync(path.join(folder(o), part(m.activePart))).size <= o.maxBytes);
  appendSignalRecord(row(0, "2026-11"), o);
  assert.equal(exported(o.dir, "2026-11").toString(), encode(row(0, "2026-11")));
  assert.deepEqual(exported(o.dir), complete);
  assert.throws(() => appendSignalRecord({ snapshotCollectedAt: "invalid" }, o));
  assert.throws(() => appendSignalRecord({ ...row(30), huge: "x".repeat(500) }, o), /size limit/);
  assert.throws(() => [...readSignalJournal("../../outside", o)], /month/);
  assert.deepEqual(exported(o.dir), complete);

  for (const after of [false, true]) {
    const r = setup(`rollover-${after}`);
    appendSignalRecord(row(0), r); appendSignalRecord(row(1), r);
    const before = exported(r.dir);
    interruptRename(manifestPath(r), after, () => appendSignalRecord(row(2), r));
    appendSignalRecord(row(2), r);
    assert.deepEqual(exported(r.dir), Buffer.concat([before, Buffer.from(encode(row(2)))]));
    assert.equal(appendSignalRecord(row(2), r).appended, false);
    assert.deepEqual(fs.readdirSync(folder(r)).sort(), ["000001.jsonl.gz", "000002.jsonl", "manifest.json"]);
  }

  // Atomic active append cannot leave half a JSON line.
  const a = setup("append-interrupt");
  appendSignalRecord(row(0), a);
  interruptRename(path.join(folder(a), "000001.jsonl"), false, () => appendSignalRecord(row(1), a));
  assert.equal(exported(a.dir).toString(), encode(row(0)));
  appendSignalRecord(row(1), a);
  assert.equal(exported(a.dir).toString(), encode(row(0)) + encode(row(1)));

  for (const after of [false, true]) {
    const r = setup(`migration-${after}`);
    const legacyFile = path.join(r.dir, "signals-2026-10.jsonl");
    fs.writeFileSync(legacyFile, original);
    interruptRename(manifestPath(r), after, () => migrateLegacySignalJournals(r));
    assert.ok(fs.existsSync(legacyFile));
    migrateLegacySignalJournals(r);
    assert.deepEqual(exported(r.dir), original);
    assert.ok(!fs.existsSync(legacyFile));
  }

  // A non-fast-forward rejection followed by git reset may leave untracked parts.
  const r = setup("git-reset");
  appendSignalRecord(row(0), r); appendSignalRecord(row(1), r);
  const baseManifest = fs.readFileSync(manifestPath(r));
  const baseActive = fs.readFileSync(path.join(folder(r), "000001.jsonl"));
  appendSignalRecord(row(2), r); // abandoned writer creates archive + next part
  fs.writeFileSync(manifestPath(r), baseManifest);
  fs.writeFileSync(path.join(folder(r), "000001.jsonl"), baseActive);
  appendSignalRecord(row(3), r); // winning branch's next snapshot
  assert.equal(exported(r.dir).toString(), encode(row(0)) + encode(row(1)) + encode(row(3)));
  assert.equal(appendSignalRecord(row(3), r).appended, false);

  const noLf = setup("no-final-newline");
  fs.writeFileSync(path.join(noLf.dir, "signals-2026-10.jsonl"), JSON.stringify(row(0)));
  migrateLegacySignalJournals(noLf);
  assert.equal(exported(noLf.dir).toString(), JSON.stringify(row(0)));
  appendSignalRecord(row(1), noLf);
  assert.equal(exported(noLf.dir).toString(), encode(row(0)) + encode(row(1)));

  // Corrupt archives are detected; a legacy source must not be removed on mismatch.
  const corrupt = setup("corrupt");
  fs.writeFileSync(path.join(corrupt.dir, "signals-2026-10.jsonl"), original);
  migrateLegacySignalJournals(corrupt);
  fs.writeFileSync(path.join(folder(corrupt), "000001.jsonl.gz"), "corrupt");
  assert.throws(() => exported(corrupt.dir));
  fs.writeFileSync(path.join(corrupt.dir, "signals-2026-10.jsonl"), original);
  assert.throws(() => migrateLegacySignalJournals(corrupt));
  assert.deepEqual(fs.readFileSync(path.join(corrupt.dir, "signals-2026-10.jsonl")), original);
  console.log("signal journal: lossless migration, bounds, replay, month rollover, interruption, reset and corruption tests OK");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
