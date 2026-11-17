"""Six fixed spot models on 1h/4h. Deterministic and exchange-client-free."""
import argparse
import collections
import json
import pathlib
import statistics
from core import STEP, iso, ms, simulate, validate_bars
from independent import ema
from run import backfill, flag_price_revisions, load_prices, write


def aggregate(rows,hours,cutoff):
    width=hours*3_600_000;count=width//STEP;groups=collections.defaultdict(list)
    for b in validate_bars(rows):
        if b[0]+STEP<=cutoff:groups[b[0]//width*width].append(b)
    out=[]
    for t,bs in sorted(groups.items()):
        if t+width>cutoff or len(bs)!=count or any(b[0]!=t+i*STEP for i,b in enumerate(bs)):continue
        out.append([t,bs[0][1],max(b[2] for b in bs),min(b[3] for b in bs),bs[-1][4],sum(b[5] for b in bs)])
    return out


def generate(market,rows,hours):
    width=hours*3_600_000;history=[];last={};out=collections.defaultdict(list)
    for b in rows:
        if history and b[0]!=history[-1][0]+width:history=[];last={}
        history.append(b);history=history[-61:]
        if len(history)<60:continue
        recent=history[-60:];cs=[x[4] for x in recent]
        previous=[x[4] for x in history[:-1]][-60:]
        close=cs[-1];e20=ema(cs,20);e50=ema(cs,50);pe20=ema(previous,20)
        atr=statistics.mean(max(recent[j][2]-recent[j][3],abs(recent[j][2]-recent[j-1][4]),abs(recent[j][3]-recent[j-1][4])) for j in range(len(recent)-14,len(recent)))
        if not atr>0:continue
        low=statistics.mean(cs[-20:])-2*statistics.pstdev(cs[-20:])
        plow=statistics.mean(cs[-21:-1])-2*statistics.pstdev(cs[-21:-1])
        diffs=[cs[j]-cs[j-1] for j in range(len(cs)-14,len(cs))]
        gains=sum(max(0,d) for d in diffs);losses=sum(max(0,-d) for d in diffs)
        rsi=100*gains/(gains+losses) if gains+losses else 50
        active={
            'trend-pullback':e20>e50 and cs[-2]<=pe20 and close>e20,
            'breakout':e20>e50 and close>max(x[2] for x in recent[-21:-1]) and b[5]>=statistics.mean(x[5] for x in recent[-21:-1]),
            'mean-reversion':cs[-2]<plow and close>=low and rsi<=40}
        for family,condition in active.items():
            edge=condition and not last.get(family,False);last[family]=condition
            if not edge:continue
            stop=close-2*atr;target=e20 if family=='mean-reversion' else close+3*(close-stop)
            if not 0<stop<close<target:continue
            out[f'{family}-{hours}h'].append(dict(market=market,availableAt=b[0]+width+1,entry=close,stop=stop,target=target,
                score=9,tradeGrade='A',family=family,btcRegime='unclassified'))
    return dict(out)


def price_audit(rows,start,end,hours,cutoff):
    wanted=(cutoff//STEP-start//STEP)
    whole=aggregate(rows,hours,cutoff);width=hours*3_600_000
    return dict(bars5m=len(rows),coverage5mPct=100*len(rows)/wanted if wanted else None,
        missing5mSlots=max(0,wanted-len(rows)),higherBars=len(whole),possibleHigherBars=max(0,cutoff//width-((start+width-1)//width)),
        firstHigher=iso(whole[0][0]) if whole else None,lastHigherClose=iso(whole[-1][0]+width) if whole else None)


def passive(bars,cfg,start,end):
    """Equal-weight passive reference; no stop/position-risk constraints."""
    initial=cfg['capital'];cash=initial;positions={};fee=cfg['feePct']/100
    spread=cfg['spreadPct']/100;slip=cfg['slipPct']/100
    t0=(start//STEP+1)*STEP;maps={m:{b[0]:b for b in rows if b[0]+STEP<=end} for m,rows in bars.items()}
    nominal=initial/len(bars);missingEntries=[];missingHeld=0;marks=[];peak=initial;dd=0
    for t in range(start//STEP*STEP,end,STEP):
        if t==t0:
            for m in sorted(maps):
                b=maps[m].get(t);prev=maps[m].get(t-STEP)
                if not b or not prev:missingEntries.append(m);continue
                cost=min(nominal,cash,prev[5]*prev[4]*cfg['participation'])
                entry=b[1]*(1+spread/2+slip);qty=cost/(entry*(1+fee))
                if cost<10:missingEntries.append(m);continue
                positions[m]=dict(qty=qty,last=b[1],entry=entry,allocatedEur=cost);cash-=cost
        for m,p in positions.items():
            b=maps[m].get(t)
            if b:p['last']=b[4]
            else:missingHeld+=1
        equity=cash+sum(p['qty']*p['last']*(1-spread/2-slip)*(1-fee) for p in positions.values())
        marks.append(equity);peak=max(peak,equity);dd=max(dd,100*(peak-equity)/peak)
    terminal=marks[-1] if marks else initial
    return dict(model='buy-hold-equal4',terminalEquityEur=terminal,netReturnPct=100*(terminal/initial-1),netLiquidationPnlEur=terminal-initial,
        maxMarkedDrawdownPct=dd,closedTrades=None,meanNetR=None,openPositions=len(positions),missingEntryMarkets=missingEntries,
        missingHeldBars=missingHeld,dataStatus='CONTAMINATED_GAPS' if missingHeld or missingEntries else 'NO_OBSERVED_HOLDING_GAPS',
        initialInvestedEur=initial-cash,uninvestedCashEur=cash,entryAllocationsEur={m:p['allocatedEur'] for m,p in positions.items()},
        riskScope='Market reference: targets equal weights, volume participation can leave cash; no stops, not risk-matched to strategy portfolios')


def report_markdown(output):
    text=['# Comparaison historique spot — modèles 1 h et 4 h','',
        '**Étude exploratoire : aucun gagnant déclaré.** Six règles fixées à l’avance ; mêmes coûts, capital et limites de risque pour les stratégies. La conservation en euros et l’achat-conservation sont des références.','',
        'La ligne overview est une simulation continue qui recouvre les autres fenêtres ; elle ne constitue pas une validation supplémentaire indépendante. Les deux fenêtres de validation sont séparées de sept jours des fenêtres précédentes. Elles restent historiques, pas prospectives.','',
        '| Fenêtre | Modèle | Stress | Clos | Ouverts | Rendement net marqué % | DD marqué % | R moyen clos | Qualité |',
        '|---|---|---|---:|---:|---:|---:|---:|---|']
    for r in output['comparisons']:
        mean='—' if r.get('meanNetR') is None else f"{r['meanNetR']:.3f}"
        clos='—' if r.get('closedTrades') is None else str(r['closedTrades'])
        text.append(f"| {r['window']} | {r['model']} | {r['stress']} | {clos} | {r.get('openPositions',0)} | {r['netReturnPct']:.3f} | {r['maxMarkedDrawdownPct']:.3f} | {mean} | {r['dataStatus']} |")
    text+=['','## Limites','']+['- '+x for x in output['limitations']]
    return '\n'.join(text)+'\n'


def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=pathlib.Path,required=True);p.add_argument('--cache',type=pathlib.Path,required=True)
    p.add_argument('--protocol',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--fetch-public',action='store_true')
    a=p.parse_args();protocol=json.loads(a.protocol.read_text());cutoff=ms(protocol['cutoff']);start=ms(protocol['dataStart'])
    snapshot=json.loads((a.root/'snapshot.json').read_text())
    if ms(snapshot['collectedAt'])!=cutoff:raise ValueError('Input snapshot does not match registered cutoff')
    if a.fetch_public:
        requests=[dict(market=m,availableAt=t+30*STEP) for m in protocol['universe'] for t in range(start,cutoff,1440*STEP)]
        backfill(requests,{},a.cache,cutoff,64)
        acquisition=json.loads((a.cache/'fetch-log.json').read_text());write(a.cache/'higher-acquisition.json',acquisition)
        if any(x['status']!='OK' for x in acquisition['events']):raise ValueError('Public data acquisition incomplete')
    raw=load_prices(a.root,a.cache)
    bars={m:[b for b in raw.get(m,[]) if start<=b[0] and b[0]+STEP<=cutoff] for m in protocol['universe']}
    if any(not rows for rows in bars.values()):raise ValueError('Missing registered market')
    audit={};signals=collections.defaultdict(list)
    for m,rows in bars.items():
        audit[m]={}
        for hours in protocol['timeframesHours']:
            tf=aggregate(rows,hours,cutoff);audit[m][str(hours)+'h']=price_audit(rows,start,cutoff,hours,cutoff)
            for model,ss in generate(m,tf,hours).items():signals[model].extend(ss)
    models=[f'{family}-{h}h' for family in protocol['families'] for h in protocol['timeframesHours']]
    results=[]
    for window,left,right in protocol['windows']:
        first,last=ms(left),min(ms(right),cutoff//STEP*STEP)
        for model in models:
            hours=int(model.rsplit('-',1)[1][:-1])
            for stress in (False,True):
                cfg=dict(protocol['portfolio'])
                if stress:cfg.update(protocol['stress'])
                r=simulate(signals.get(model,[]),bars,cfg,first,last)
                flag_price_revisions(r,a.cache,first,last,set(bars),61*hours*3_600_000)
                r.update(model=model,window=window,stress=stress,start=iso(first),end=iso(last))
                results.append(r)
        results.append(dict(model='EUR-cash',window=window,stress=False,netReturnPct=0.,terminalEquityEur=protocol['portfolio']['capital'],
            maxMarkedDrawdownPct=0.,closedTrades=0,meanNetR=None,openPositions=0,dataStatus='DETERMINISTIC_CASH_REFERENCE'))
        for stress in (False,True):
            cfg=dict(protocol['portfolio'])
            if stress:cfg.update(protocol['stress'])
            r=passive(bars,cfg,first,last);flag_price_revisions(r,a.cache,first,last,set(bars))
            r.update(window=window,stress=stress);results.append(r)
    result=dict(protocol=protocol,dataAudit=audit,signalCounts={m:len(signals.get(m,[])) for m in models},comparisons=results,
        decision='PRELIMINARY_NO_WINNER',limitations=[
            'About two months of prices: enough for a first view, not proof across market regimes; 4h trade counts may be very small.',
            'No tuning or automatic model selection; current and earlier market/Strict outcomes were already visible. Final chronological window is not pristine prospective evidence.',
            'Each strategy has the same 300 EUR capital and risk limits. Passive buy-and-hold targets equal weights but may leave cash due to volume participation limits; no stops, so its risk/exposure differs. Stress changes both costs and liquidity, so lower stress losses do not demonstrate cost robustness.',
            'All costs and liquidity are modeled. Spot only, previous 5m volume participation, next 5m open, adverse stop slippage and stop-first intrabar policy.',
            'Max hold 168h for all six models; positions open at cutoff remain censored. Marked return includes estimated liquidation costs; mean R counts closed trades only.',
            'A higher-timeframe candle is rejected if any underlying 5m candle is missing; no interpolation. Indicator history resets on missing higher bars.',
            'Candle revisions use the existing original-cache-first policy and remain explicitly logged; affected windows including warmup are flagged.',
            'Four fixed major assets are a chosen research universe, not an exhaustive or survivorship-free exchange universe.',
            'Frozen engines/protocols and live trading are unchanged. No orders or deployments.'])
    write(a.out/'higher-report.json',result);(a.out/'HIGHER_REPORT.md').write_text(report_markdown(result))
    print('HIGHER_AUDIT',json.dumps(dict(dataAudit=audit,signalCounts=result['signalCounts'])))
    for r in results:print('HIGHER_RESULT',json.dumps({k:v for k,v in r.items() if k not in ('trades','assumptions','censoredPositions')}))
if __name__=='__main__':main()
