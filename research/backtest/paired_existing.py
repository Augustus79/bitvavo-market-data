"""Descriptive paired exit deltas; not selection-adjusted inference."""
import collections,json,pathlib,statistics
root=pathlib.Path(__file__).resolve().parents[2]
groups=collections.defaultdict(list)
for line in (root/'exit-shadow/trades.jsonl').read_text().splitlines():
    if not line.strip():continue
    r=json.loads(line)
    if r.get('baselineNetR') is not None:groups[r['policyId']].append(r['netR']-r['baselineNetR'])
print(json.dumps({k:dict(pairedTrades=len(v),meanDeltaR=statistics.mean(v),positiveDelta=sum(x>1e-10 for x in v),negativeDelta=sum(x<-1e-10 for x in v)) for k,v in groups.items()},indent=2))
