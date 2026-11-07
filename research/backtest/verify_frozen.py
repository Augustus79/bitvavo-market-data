"""Fail closed if source blobs differ from audited source pin."""
import hashlib
import json
import pathlib
root=pathlib.Path(__file__).resolve().parents[2]
pin=json.loads((root/'research/backtest/sources.json').read_text())
for row in pin['frozen']:
    b=(root/row['path']).read_bytes()
    actual=hashlib.sha1(f'blob {len(b)}\0'.encode()+b).hexdigest()
    if actual!=row['sha']:raise SystemExit(f"Frozen source mismatch: {row['path']}")
print('Frozen engine and protocol blob hashes verified')
