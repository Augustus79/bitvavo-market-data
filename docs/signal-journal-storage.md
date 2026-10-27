# Bounded signal history

The trading model and current `signals.json` are unchanged. Only the archival
signal journal uses this format. No in-repository trading/evaluation reader uses
`history/signals-YYYY-MM.jsonl`; external consumers of that former path must use
the exporter below. No Worker deployment is needed.

## Layout and limits

`history/signals-YYYY-MM/manifest.json` lists immutable gzip parts in order and
the numbered active `.jsonl` part. Each uncompressed part is at most 16 MiB.
Compressed parts are additionally checked below 32 MiB, leaving ample margin
under GitHub's 100 MiB file limit. The manifest records uncompressed SHA-256,
byte count and timestamp range for each archive. Snapshot keys are unchanged.

The first successful generator run migrates existing monthly signal journals,
including earlier months. Source bytes (including blank/malformed lines and
line endings) are preserved. Compression is verified before the manifest is
published, then the concatenated archive hash is checked against the original
before removing the old monthly file. Nothing rewrites Git history: the original
files remain available in prior commits. Migration only reduces the current
checkout; it does not shrink the repository's existing Git object database.

Normal appends read only the bounded active part. A replay also checks archived
parts whose timestamp ranges can contain that snapshot. Closed parts are not
recompressed on each collection. No retention expiry or deletion of journal
records is introduced. Other paper/AI/evaluation journals are unchanged.

## Export and inspection

From the repository root, export to a path **outside `history/`**:

```sh
node export-signal-history.mjs 2026-10 > /tmp/signals-2026-10.jsonl
```

The exporter supports both old monthly files and the new manifest format and
checks archive hashes. Do not put exported oversized monthly files back into
Git. During validation, compare SHA-256 of the original and the exported bytes
before any new record is appended. After collection resumes, the original must
remain the exact prefix, followed by new records.

## Failure and concurrency handling

Each local file is replaced atomically. Rotation writes archives and the next
active part before replacing the manifest; the previous source is removed last.
A failed/interrupted migration preserves the legacy source until recovery checks
succeed. Extra unreferenced parts left by interruption or a failed Git push/reset
are cleaned according to the manifest, never treated as committed history.

This storage assumes one writer per checkout, as in the existing workflows.
Independent runners still use the existing fetch/reset/rebuild and non-force
push retries. Git publishes the manifest, archives, active part and derived state
in the same commit. There is no new lock, scheduler, endpoint or external storage.

## Validation and rollback

`npm test` includes journal tests for lossless migration, Unicode, bounded parts,
duplicates in archives, month rollover, corrupt archives, interrupted writes and
stale untracked files following a rejected publication. A production-history copy
must also round-trip byte-for-byte before rollout.

After merge, observe a natural run: tests and publication succeed, old monthly
files are replaced by checked archives, file sizes remain bounded, and the alert
response is inspected separately from the green Actions status. The existing
five-minute collection cadence and live protection settings are unchanged.

If a deployment issue occurs before the first migrated commit, revert only code
changes. After migration, **do not revert the writer alone**: it would recreate a
monthly file beside the archives and lose cross-format duplicate detection.
Keep the new reader/format and fix forward, or prepare a verified offline export
and a compatible bounded writer before switching. Never reset the whole branch,
snapshots, paper state, Worker state or trading state to an earlier commit.

## Remaining capacity limits

This prevents the identified monthly signal-file limit and compresses future
sealed parts. Total retained history still grows: monitor repository size and
plan cold storage separately if necessary. It does not change other journal
formats or claim to resolve alert-lock contention or Cloudflare CPU limits.
