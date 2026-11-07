"""Fixed causal OHLC-only entry rules, independent of the Strict journal."""
import argparse
import bisect
import collections
import json
import math
import pathlib
import statistics
from core import STEP, iso, ms, simulate, validate_bars
from run import backfill, flag_price_revisions, load_prices, variants, write


def ema(values,period):
    result=values[0];alpha=2/(period+1)
    for v in values[1:]:result=alpha*v+(1-alpha)*result
    return result


def aggregate_hours(rows):
    groups=collections.defaultdict(list)
    for b in rows:groups[b[0]//3_600_000*3_600_000].append(b)
    out=[]
    for t,bs in sorted(groups.items()):
        if [b[0] for b in bs]!=[t+i*STEP for i in range(12)]:continue
        out.append([t,bs[0][1],max(b[2] for b in bs),min(b[3] for b in bs),bs[-1][4],sum(b[5] for b in bs)])
    return out


def independent_signals(market,rows):
    rows=validate_bars(rows);hours=aggregate_hours(rows);ht=[b[0] for b in hours]
    result=collections.defaultdict(list);history=[];last={}
    for b in rows:
        if history and b[0]!=history[-1][0]+STEP:history=[];last={}
        history.append(b);history=history[-600:]
        if len(history)<600:continue
        close_at=b[0]+STEP
        j=bisect.bisect_right(ht,close_at-3_600_000)
        hs=hours[max(0,j-50):j]
        if len(hs)<50 or hs[-1][0]+3_600_000>close_at or any(y[0]-x[0]!=3_600_000 for x,y in zip(hs,hs[1:])):continue
        hc=[h[4] for h in hs];up=ema(hc,20)>ema(hc,50)
        cs=[h[4] for h in history];close=cs[-1]
        atr=statistics.mean(max(history[k][2]-history[k][3],abs(history[k][2]-history[k-1][4]),abs(history[k][3]-history[k-1][4])) for k in range(len(history)-14,len(history)))
        if atr<=0:continue
        changes=[cs[k]-cs[k-1] for k in range(len(cs)-14,len(cs))]
        gains=sum(max(0,x) for x in changes);losses=sum(max(0,-x) for x in changes)
        rsi=100*gains/(gains+losses) if gains+losses else 50
        mid=ema(cs,20);pmid=ema(cs[:-1],20)
        low=statistics.mean(cs[-20:])-2*statistics.pstdev(cs[-20:])
        plow=statistics.mean(cs[-21:-1])-2*statistics.pstdev(cs[-21:-1])
        donchian=max(h[2] for h in history[-21:-1]);vmean=statistics.mean(h[5] for h in history[-21:-1])
        conditions={
            'donchian-breakout':up and close>donchian and b[5]>1.5*vmean,
            'trend-pullback':up and cs[-2]<=pmid and close>mid and 40<=rsi<=60,
            'mean-reversion':cs[-2]<plow and close>=low and rsi<=40 and hc[-1]>=ema(hc,50)}
        for name,active in conditions.items():
            edge=active and not last.get(name,False);last[name]=active
            if not edge:continue
            stop=close-2*atr if name=='donchian-breakout' else min(h[3] for h in history[-5:])-.5*atr
            target=mid if name=='mean-reversion' else close+3*(close-stop)
            if not 0<stop<close<target:continue
            result[name].append(dict(market=market,availableAt=close_at+1,entry=close,stop=stop,target=target,
                score=9,tradeGrade='A',family=name,btcRegime='unclassified'))
    return dict(result)


def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True)
    p.add_argument('--cache',type=pathlib.Path,required=True);p.add_argument('--protocol',type=pathlib.Path,required=True);p.add_argument('--fetch-public',action='store_true')
    a=p.parse_args();protocol=json.loads(a.protocol.read_text());start=ms(protocol['independentDataStart']);cutoff=ms(protocol['inputCutoff'])
    if a.fetch_public:
        # Reuse bounded candle client and canonical UTC chunks; no Strict events used.
        requests=[dict(market=m,availableAt=t+30*STEP) for m in protocol['independentUniverse'] for t in range(start,cutoff,1440*STEP)]
        backfill(requests,{},a.cache,cutoff,80)
        log=json.loads((a.cache/'fetch-log.json').read_text());write(a.cache/'independent-fetch-log.json',log)
    bars=load_prices(a.root,a.cache);bars={m:[b for b in bars.get(m,[]) if start<=b[0] and b[0]+STEP<=cutoff] for m in protocol['independentUniverse']}
    signals=collections.defaultdict(list)
    for m,bs in bars.items():
        for name,ss in independent_signals(m,bs).items():signals[name].extend(ss)
    results=[];base=dict(variants()[0][1])
    for window,left,right in protocol['windows']:
        for name in protocol['independentStrategies']:
            for stress in (False,True):
                cfg=base|dict(exit='target' if name=='mean-reversion' else 'trail-1.5r')
                if stress:cfg|=dict(spreadPct=.25,slipPct=.1,stopSlipPct=.8,participation=.005)
                r=simulate(signals.get(name,[]),bars,cfg,ms(left),min(ms(right),cutoff//STEP*STEP))
                flag_price_revisions(r,a.cache,ms(left),min(ms(right),cutoff//STEP*STEP),set(bars),600*STEP)
                r.update(variant=name,window=window,stress=stress,scope='EXPLORATORY_INDEPENDENT_ENTRY_RESEARCH')
                results.append(r)
    audit=dict(universe=protocol['independentUniverse'],signalCounts={k:len(v) for k,v in signals.items()},
        marketData={m:dict(bars=len(bs),first=iso(bs[0][0]) if bs else None,last=iso(bs[-1][0]) if bs else None) for m,bs in bars.items()},
        indicatorWarmupBars=600,protocol=protocol['id'],decision='NO_WINNER_SELECTION')
    write(a.out/'independent.json',dict(audit=audit,comparisons=results))
    text=['# Entrées indépendantes de Strict — recherche exploratoire','',
        'Règles et univers fixes, aucune optimisation. Ces fenêtres sont rétrospectives, pas une nouvelle validation prospective. Les coûts et la liquidité restent modélisés.','',
        '| Fenêtre | Stratégie | Stress | Clos | Net € | Rendement % | DD % | R moyen | Données |',
        '|---|---|---|---:|---:|---:|---:|---:|---|']
    for r in results:
        mean='—' if r['meanNetR'] is None else f"{r['meanNetR']:.3f}"
        text.append(f"| {r['window']} | {r['variant']} | {r['stress']} | {r['closedTrades']} | {r['netPnlEur']:.3f} | {r['netReturnPct']:.3f} | {r['maxMarkedDrawdownPct']:.3f} | {mean} | {r['dataStatus']} |")
    (a.out/'INDEPENDENT.md').write_text('\n'.join(text)+'\n')
    print('INDEPENDENT_AUDIT',json.dumps(audit))
    for r in results:print('INDEPENDENT_RESULT',json.dumps({k:v for k,v in r.items() if k not in ('trades','assumptions','censoredPositions')}))
if __name__=='__main__':main()
