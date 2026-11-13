"""Run audit/backfill/research with the Python standard library only."""
import argparse
import collections
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from core import STEP, digest, iso, load_journal, metrics, ms, signals_from, simulate, validate_bars

HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parent.parent

def write(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(obj,indent=2,sort_keys=True,allow_nan=False)+'\n')

def load_prices(root,cache):
    """Preserve original pinned vintage; log every cross-source discrepancy.

    This policy is opt-in via baseline-price-vintage.json. Conflicts within a
    single source still fail in validate_bars; cache checksums always fail closed.
    Priority: original Oct31 cache, then other cached API chunks, then current
    snapshot. Filename order breaks ties deterministically. No source is edited.
    """
    snapshot=json.loads((root/'snapshot.json').read_text());cutoff=ms(snapshot['collectedAt'])
    manifest_path=HERE/'baseline-price-vintage.json'
    manifest=json.loads(manifest_path.read_text())['files'] if manifest_path.exists() else None
    sources=[]
    for m,d in snapshot.get('deep',{}).items():
        rows=[b for b in d.get('candles',{}).get('5m',[]) if float(b[0])+STEP<=cutoff]
        sources.append((2,'snapshot.json@'+snapshot['collectedAt'],m,validate_bars(rows)))
    if cache.exists():
        for p in sorted(cache.glob('*.json')):
            obj=json.loads(p.read_text())
            if obj.get('schema')!='public-candles-cache-v1':continue
            if digest(json.dumps(obj['bars'],separators=(',',':')).encode())!=obj['sha256']:
                raise ValueError(f'Cache checksum mismatch {p}')
            priority=1
            if manifest is not None and p.name in manifest:
                if obj['sha256']!=manifest[p.name]:raise ValueError(f'Original vintage changed: {p.name}')
                priority=0
            sources.append((priority,p.name,obj['market'],validate_bars(obj['bars'])))
    chosen={};conflicts={}
    for priority,source,m,rows in sorted(sources,key=lambda x:(x[0],x[1],x[2])):
        for b in rows:
            key=(m,b[0])
            if key not in chosen:chosen[key]=(source,b)
            elif chosen[key][1]!=b:
                if manifest is None:raise ValueError('Conflicting OHLCV duplicate without registered vintage policy')
                c=conflicts.setdefault(key,dict(market=m,timestamp=b[0],chosenSource=chosen[key][0],chosenBar=chosen[key][1],alternatives=[]))
                c['alternatives'].append(dict(source=source,bar=b))
    if manifest is not None:
        write(cache/'price-revisions.json',dict(policy='Original Oct31 cache, other cached API chunks, then snapshot; source names break ties',
            conflictingMarketBars=len(conflicts),conflicts=[conflicts[k] for k in sorted(conflicts)]))
    bars=collections.defaultdict(list)
    for (m,t),(source,b) in sorted(chosen.items()):bars[m].append(b)
    return dict(bars)


def flag_price_revisions(result,cache,start,end,markets,warmup=0):
    path=cache/'price-revisions.json'
    conflicts=json.loads(path.read_text())['conflicts'] if path.exists() else []
    n=sum(c['market'] in markets and start-warmup<=c['timestamp']<end for c in conflicts)
    result['priceRevisionBarsInWindow']=n
    result['priceVintagePolicy']='original-cache-first; alternatives retained'
    if n:result['dataStatus']='CONTAMINATED_PRICE_REVISIONS'
    return result


def backfill(signals,bars,cache,cutoff,budget):
    """Only GET /v2/{EUR market}/candles, no authentication, no private endpoint.
    Fixed 5-day UTC chunks cover candidate lifetimes plus indicator warmup.
    Cached empty responses are kept; no retry storms and no interpolation.
    """
    span=1440*STEP
    requests=set()
    for s in signals:
        m=s['market']
        if not re.fullmatch(r'[A-Z0-9]+-EUR',m): raise ValueError('Invalid public market')
        start=(s['availableAt']-30*STEP)//span*span
        end=min(cutoff,s['availableAt']+48*3_600_000)
        for t in range(start,end,span): requests.add((m,t))
    log=[]; calls=0
    for m,start in sorted(requests):
        end=min(start+span,cutoff//STEP*STEP)
        path=cache/f'{m}-{start}-{end}.json'
        if path.exists(): continue
        if calls>=budget:
            log.append(dict(status='BUDGET_EXHAUSTED',remainingChunks=len(requests)-len(log))); break
        query=urllib.parse.urlencode(dict(interval='5m',start=start,end=end,limit=1440))
        url=f'https://api.bitvavo.com/v2/{m}/candles?{query}'
        calls+=1
        try:
            # Explicit GET, no keys or signatures are read anywhere in this module.
            req=urllib.request.Request(url,headers={'Accept':'application/json','User-Agent':'bitvavo-offline-research/1'},method='GET')
            with urllib.request.urlopen(req,timeout=20) as response:
                raw=response.read(); rows=validate_bars(json.loads(raw))
            rows=[r for r in rows if start<=r[0]<end and r[0]+STEP<=cutoff]
            obj=dict(schema='public-candles-cache-v1',market=m,url=url,intervalMs=STEP,
                bars=rows,sha256=digest(json.dumps(rows,separators=(',',':')).encode()),rawSha256=digest(raw))
            write(path,obj); log.append(dict(market=m,start=start,end=end,status='OK',bars=len(rows)))
            time.sleep(.12)
        except Exception as e:
            log.append(dict(market=m,status='ERROR',error=str(e)))
            # Stop on network/auth/rate-limit trouble; preserve completed cache.
            break
    write(cache/'fetch-log.json',dict(plannedChunks=len(requests),apiCalls=calls,events=log))
    return log

def variants():
    base=dict(capital=300.,feePct=.25,spreadPct=.10,slipPct=.03,stopSlipPct=.40,
        maxPositions=2,riskEur=1.,openRiskEur=3.,maxNotionalEur=100.,dailyLossEur=5.,
        participation=.01,maxHoldingHours=48,exit='target')
    out=[]
    for name,change in [
        ('strict-entry-research',{}),
        ('runner-1r',dict(exit='trail-1r')),('runner-1.5r',dict(exit='trail-1.5r')),
        ('half-target-runner',dict(exit='partial')),
        ('adaptive-exit-proxy',dict(exit='adaptive',maxPositions=3)),
        ('adaptive-original-entry-gates',dict(exit='adaptive',maxPositions=3,originalAdaptiveGates=True)),
        ('dynamic-portfolio-proxy',dict(exit='partial',maxPositions=3,portfolio='dynamic')),
        ('grade-a-runner',dict(exit='adaptive',entryFilter='grade-a',maxPositions=3)),
        ('risk-on-runner',dict(exit='adaptive',entryFilter='risk-on',maxPositions=3)),
        ('relative-strength-runner',dict(exit='adaptive',entryFilter='relative-strength',maxPositions=3)),
        ('single-position',dict(maxPositions=1)),
    ]:
        out.append((name,base|change))
    return out

def descriptive(root):
    out={}
    for name,path in [('Strict','paper/trades.jsonl'),('Adaptive Runner v1','adaptive-shadow/trades.jsonl'),
        ('Exit shadows','exit-shadow/trades.jsonl'),('Portfolio shadow','portfolio-shadow/trades.jsonl')]:
        p=root/path
        if not p.exists(): continue
        rows=[json.loads(x) for x in p.read_text().splitlines() if x.strip()]
        groups=collections.defaultdict(list)
        for r in rows:
            # These files are already closed-trade ledgers, not a chronological backtest.
            pnl=r.get('netPnlEur'); risk=r.get('plannedRiskEur')
            if pnl is None: continue
            q=dict(r)
            if q.get('netR') is None and risk and risk>0: q['netR']=pnl/risk
            if q.get('netR') is None: continue
            groups[r.get('policyId',r.get('variantId',r.get('model',name)))].append(q)
        out[name]={str(k):dict(closed=len(v),netPnlEur=sum(r['netPnlEur'] for r in v),
            meanNetR=sum(r['netR'] for r in v)/len(v),gapped=sum(bool(r.get('dataGapped')) for r in v),
            scope='DESCRIPTIVE_EXISTING_SHADOW_NOT_COMPARABLE_OOS') for k,v in groups.items()}
    return out

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--root',type=pathlib.Path,default=ROOT)
    p.add_argument('--out',type=pathlib.Path,default=HERE/'results')
    p.add_argument('--cache',type=pathlib.Path,default=HERE/'cache')
    p.add_argument('--fetch-public',action='store_true')
    p.add_argument('--protocol',type=pathlib.Path)
    p.add_argument('--prepare-data-only',action='store_true',help='Verify/backfill inputs without computing simulations')
    p.add_argument('--max-api-calls',type=int,default=120)
    p.add_argument('--allow-partial',action='store_true',help='Only for connector-limited local audit; never a complete historical run')
    args=p.parse_args(); root=args.root; out=args.out
    protocol=json.loads(args.protocol.read_text()) if args.protocol else None
    manifest_paths=list((root/'history').glob('signals-????-??/manifest.json'))
    missing=[]
    for path in manifest_paths:
        m=json.loads(path.read_text())
        for name in [x['file'] for x in m['sealed']]+[f"{m['activePart']:06}.jsonl"]:
            if not (path.parent/name).exists(): missing.append(str(path.parent.name+'/'+name))
    if not manifest_paths: raise ValueError('No journal manifests found; refusing an empty historical run')
    partial=bool(missing)
    if partial and not args.allow_partial: raise ValueError(f'Missing journal parts: {missing}')
    if partial:
        rows=[]; audit=dict(status='BLOCKED_ARCHIVE_ACCESS',missingParts=missing)
    else: rows,audit=load_journal(root)
    sigs=signals_from(rows)
    context_path=args.cache/'entry-contexts.json'
    contexts=json.loads(context_path.read_text()).get('contexts',{}) if context_path.exists() else {}
    for s in sigs: s['historicalContext']=contexts.get(s['snapshotAt']+'|'+s['market'])
    bars=load_prices(root,args.cache)
    cutoff=ms(rows[-1]['snapshotCollectedAt']) if rows else ms(json.loads((root/'snapshot.json').read_text())['collectedAt'])
    if args.fetch_public and not partial:
        backfill(sigs,bars,args.cache,cutoff,args.max_api_calls)
        bars=load_prices(root,args.cache)
    audit.update(recoveredEntryContexts=len(contexts),causalBuyEdges=len(sigs),priceMarkets={m:dict(bars=len(bs),start=iso(bs[0][0]),end=iso(bs[-1][0]),
        missing5mSlots=sum((b[0]-a[0])//STEP-1 for a,b in zip(bs,bs[1:]))) for m,bs in sorted(bars.items()) if bs},
        fullHistoricalSnapshotsAvailable=False,orderBookHistoryAvailable='ENTRY_POINTS_ONLY' if contexts else False,
        interpretation='Entry liquidity gates recovered at exact timestamps; full timeline and execution remain research proxies' if contexts else 'RESEARCH_PROXIES_ONLY; entry liquidity gates unavailable',
        sourcePin=json.loads((HERE/'sources.json').read_text()),
        extensionProtocol=protocol)
    if args.prepare_data_only:
        write(out/'prepared-audit.json',audit)
        return
    results=[]
    # Fixed before outcomes. Sep22-Oct10 is development; no fitted parameters.
    # Two subsequent non-overlapping validation windows, 48h purge/embargo.
    windows=[('development','2026-09-22T16:00:00Z','2026-10-10T00:00:00Z'),
        ('validation-1','2026-10-12T00:00:00Z','2026-10-20T00:00:00Z'),
        ('validation-2','2026-10-22T00:00:00Z','2026-10-31T17:00:00Z')]
    if protocol: windows=protocol['windows']
    if not partial:
        for window,a,b in windows:
            start,end=ms(a),min(ms(b),cutoff//STEP*STEP)
            if end<=start: continue
            for name,cfg in variants():
                for stress in (False,True):
                    c=cfg|dict(spreadPct=.25,slipPct=.10,stopSlipPct=.80,participation=.005) if stress else cfg
                    r=simulate(sigs,bars,c,start,end)
                    flag_price_revisions(r,args.cache,start,end,{s['market'] for s in sigs})
                    r.update(window=window,start=iso(start),end=iso(end),variant=name,stress=stress)
                    results.append(r)
    output=dict(audit=audit,existingShadowDescriptive=descriptive(root),comparisons=results,
        decision='INSUFFICIENT_EVIDENCE_NO_WINNER',
        caveats=['All historical outcomes have previously existed: this is retrospective OOS, not pristine prospective evidence.',
            'Fixed variants; no automatic selection or refitting on validation.',
            'Journal is limited to the contemporaneously selected deep-market universe, with selection bias.',
            'Historical quotes/books recovered at entry points when contexts are present; no continuous order-book/trade tape or historical instrument precision metadata; execution remains modeled.',
            'Conflicting cross-source candle vintages are preserved and logged; original Oct31 cache is selected first, then API cache, then snapshot; affected windows are not clean evidence.',
            'OHLCV gaps can mean no trades or missing data; never forward-filled.',
            '48h holding limit changes frozen model economics; research proxies must not be named frozen Strict/Adaptive equivalents.',
            'Missing held bars contaminate complete portfolio runs; results not eligible as evidence.',
            'No winner: small samples, costs and market regimes require further prospective validation.'])
    write(out/'report.json',output)
    text=['# Backtest historique Bitvavo — recherche isolée','',
        'Décision : **preuves insuffisantes, aucun modèle gagnant**.','',
        '## Audit', '', f"État : {audit.get('status','ARCHIVES_VERIFIED')}. Signaux BUY causaux : {len(sigs)}.",
        f"Snapshots : {audit.get('snapshots','non lus')}. Couverture : {audit.get('start')} → {audit.get('end')}.",
        'Bougies : 5 minutes. Les carnets et spreads historiques ne sont pas archivés dans le journal compact.',
        '', '## Résultats comparatifs', '',
        '| Fenêtre | Variante de recherche | Stress | Clos | Net € | Rendement % | DD marqué % | R moyen | Qualité |',
        '|---|---|---|---:|---:|---:|---:|---:|---|']
    for r in results:
        mean='—' if r['meanNetR'] is None else f"{r['meanNetR']:.3f}"
        text.append(f"| {r['window']} | {r['variant']} | {r['stress']} | {r['closedTrades']} | {r['netPnlEur']:.3f} | {r['netReturnPct']:.3f} | {r['maxMarkedDrawdownPct']:.3f} | {mean} | {r['dataStatus']} |")
    if not results: text+=['','Comparaison historique non exécutée : archives indisponibles dans cette exécution. Aucun résultat synthétique substitué.']
    text+=['','## Simulations existantes : descriptif seulement','', '```json',json.dumps(output['existingShadowDescriptive'],indent=2),'```','',
        '## Limites et protocole','']+['- '+x for x in output['caveats']]
    (out/'REPORT.md').write_text('\n'.join(text)+'\n')
    print(json.dumps(dict(decision=output['decision'],audit=audit,existingShadowDescriptive=output['existingShadowDescriptive'],
        comparisons=[{k:v for k,v in r.items() if k not in ('trades','assumptions','censoredPositions')} for r in results]),sort_keys=True))

if __name__=='__main__': main()
