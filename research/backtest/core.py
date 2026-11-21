"""Offline-only, deterministic research simulation. No exchange client or credentials."""
import bisect
import collections
import datetime as dt
import gzip
import hashlib
import json
import math
import pathlib
import statistics

STEP = 300_000

def ms(s):
    return int(dt.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()*1000)

def iso(t):
    return dt.datetime.fromtimestamp(t/1000, dt.timezone.utc).isoformat()

def digest(b):
    return hashlib.sha256(b).hexdigest()

def load_journal(root):
    """Verify sealed manifests before parsing; reject corruption, conflicting duplicates."""
    records, inputs = {}, []
    duplicates = 0
    for folder in sorted((root/'history').glob('signals-????-??')):
        m = json.loads((folder/'manifest.json').read_text())
        if m['schemaVersion'] != 1 or m['activePart'] != len(m['sealed'])+1:
            raise ValueError('Invalid manifest')
        parts = m['sealed'] + [{'file': f"{m['activePart']:06}.jsonl"}]
        for part in parts:
            p = folder/part['file']
            raw = p.read_bytes()
            b = gzip.decompress(raw) if p.suffix == '.gz' else raw
            if 'sha256' in part and (digest(b) != part['sha256'] or len(b) != part['bytes']):
                raise ValueError(f'Corrupt sealed part {p}')
            if b and not b.endswith(b'\n'):
                raise ValueError(f'Incomplete final line {p}')
            count = 0
            for line in b.splitlines():
                r = json.loads(line)
                t = ms(r['snapshotCollectedAt'])
                if t in records:
                    if records[t] != r:
                        raise ValueError(f'Conflicting snapshot at {t}')
                    duplicates += 1
                records[t] = r
                count += 1
            inputs.append(dict(path=str(p.relative_to(root)), bytes=len(b), sha256=digest(b), rows=count))
    rows = [records[t] for t in sorted(records)]
    times = sorted(records)
    gaps = [b-a for a,b in zip(times,times[1:])]
    signals = [s for r in rows for s in r.get('signals',[])]
    audit = dict(inputs=inputs, snapshots=len(rows), duplicates=duplicates,
        start=iso(times[0]) if times else None, end=iso(times[-1]) if times else None,
        medianIntervalSec=statistics.median(gaps)/1000 if gaps else None,
        p95IntervalSec=sorted(gaps)[int(.95*(len(gaps)-1))]/1000 if gaps else None,
        gapsOver10Min=sum(g>600_000 for g in gaps), maxGapSec=max(gaps,default=0)/1000,
        gridCoveragePct=100*len({t//STEP for t in times})/(1+(times[-1]//STEP-times[0]//STEP)) if times else 0,
        markets=sorted({s['market'] for s in signals}), buySignals=sum(s.get('action')=='BUY' for s in signals),
        engineVersions=sorted({str(r.get('engineVersion')) for r in rows}),
        missingExecutionFields={k:sum(s.get(k) is None for s in signals) for k in ['spreadPct','bidDepth10','volumeQuote']})
    return rows, audit

def validate_bars(rows):
    out = {}
    for row in rows:
        if len(row) != 6:
            raise ValueError('OHLCV row length')
        t, o,h,l,c,v = map(float,row)
        if not all(math.isfinite(x) for x in [t,o,h,l,c,v]) or t != int(t) or int(t)%STEP:
            raise ValueError('Invalid OHLCV timestamp/numbers')
        if min(o,h,l,c)<=0 or v<0 or h<max(o,l,c) or l>min(o,h,c):
            raise ValueError('Invalid OHLCV geometry')
        b = [int(t),o,h,l,c,v]
        if int(t) in out and out[int(t)] != b:
            raise ValueError('Conflicting OHLCV duplicate')
        out[int(t)] = b
    return [out[t] for t in sorted(out)]

def signals_from(rows):
    """Only new BUY edges; reset after unobserved market or >10min observation gap."""
    last, result = {}, []
    for r in rows:
        t = max(ms(r['snapshotCollectedAt']), ms(r.get('analyzedAt') or r['snapshotCollectedAt']))
        present = set()
        for s in r.get('signals',[]):
            market = s['market']; present.add(market)
            prev, pt = last.get(market, (None,None))
            last[market] = (s.get('action'),t)
            # Unknown previous state must not be fabricated as a fresh rising edge.
            if s.get('action') != 'BUY' or prev in (None,'BUY') or t-pt>600_000:
                continue
            if not r.get('snapshotFresh',False) or not s.get('dataQualityOk',False):
                continue
            if t-ms(r['snapshotCollectedAt'])>120_000:
                continue
            q = dict(s, availableAt=t, snapshotAt=r['snapshotCollectedAt'], btcRegime=r.get('btcRegime'))
            result.append(q)
        last = {k:v for k,v in last.items() if k in present}
    return sorted(result,key=lambda s:(s['availableAt'],s['market']))

def metrics(trades, equity, initial):
    pnl=[x['netPnlEur'] for x in trades]
    rs=[x['netR'] for x in trades]
    peak=initial; dd=0
    for e in equity:
        peak=max(peak,e); dd=max(dd,(peak-e)/peak*100)
    n=len(pnl)
    mean=statistics.mean(rs) if n else None
    # Descriptive only: dependence and multiple trials invalidate winner selection by this interval.
    se=statistics.stdev(rs)/math.sqrt(n) if n>1 else None
    return dict(closedTrades=n, netPnlEur=sum(pnl), terminalEquityEur=equity[-1] if equity else initial,
        netReturnPct=((equity[-1] if equity else initial)/initial-1)*100,
        maxMarkedDrawdownPct=dd, meanNetEur=statistics.mean(pnl) if n else None,
        meanNetR=mean, descriptiveNormal95R=[mean-1.96*se,mean+1.96*se] if se is not None else None,
        winRate=sum(p>0 for p in pnl)/n if n else None,
        status='EXPLORATORY_NO_WINNER')

def simulate(signals, bars, cfg, start, end):
    """Use completed signals, next full 5m open; exits stop-first, trail effective next bar.

    Liquidity sizing uses PREVIOUS completed bar volume, never fill-bar volume.
    Missing bars while holding contaminate the whole run; no selective deletion.
    """
    initial=cfg.get('capital',300.); cash=initial; positions={}; trades=[]; rejects=collections.Counter()
    fee=cfg.get('feePct',.25)/100; spread=cfg.get('spreadPct',.10)/100
    slip=cfg.get('slipPct',.03)/100; stop_slip=cfg.get('stopSlipPct',.4)/100
    exit_kind=cfg.get('exit','target'); cap=cfg.get('maxPositions',2)
    by_time=collections.defaultdict(list)
    for s in signals:
        t=((s['availableAt']//STEP)+1)*STEP
        if start<=s['availableAt']<end and start<=t<end:
            by_time[t].append(s)
    maps={m:{b[0]:b for b in bs if b[0]+STEP<=end} for m,bs in bars.items()}
    history={m:[] for m in maps}; equity=[]; dirty=False; missing=0; high_water=initial; daily={}
    def fill_price(raw,side,stop=False):
        return raw*(1+spread/2+slip) if side=='buy' else raw*(1-spread/2-(stop_slip if stop else slip))
    def sell(p, raw, fraction, t, reason):
        nonlocal cash
        qty=min(p['remaining'],p['quantity']*fraction)
        price=fill_price(raw,'sell',reason=='stop')
        proceeds=qty*price*(1-fee); cash+=proceeds
        p['realized']+=proceeds-qty*p['entry']*(1+fee)
        p['remaining']-=qty
        if p['remaining']<=p['quantity']*1e-10:
            trades.append(dict(market=p['market'],openedAt=iso(p['opened']),closedAt=iso(t),
                netPnlEur=p['realized'],netR=p['realized']/p['risk'],reason=reason,dataGapped=p['gapped']))
            del positions[p['market']]
    for t in range((start//STEP)*STEP,end,STEP):
        day=t//86_400_000
        # Portfolio loss cap uses marked equity captured at previous completed step.
        prior_equity=equity[-1] if equity else initial
        daily.setdefault(day,prior_equity)
        # Process all market orders from signals available strictly before this bar opens.
        for s in sorted(by_time.get(t,[]),key=lambda s:(-float(s.get('score') or 0),s['market'])):
            m=s['market']; b=maps.get(m,{}).get(t); prev=maps.get(m,{}).get(t-STEP)
            if not b or not prev: rejects['missing_entry_or_previous_bar']+=1; continue
            if m in positions or len(positions)>=cap: rejects['capacity']+=1; continue
            if prior_equity<=daily[day]-cfg.get('dailyLossEur',5): rejects['daily_loss']+=1; continue
            if cfg.get('entryFilter')=='grade-a' and s.get('tradeGrade')!='A': rejects['filter']+=1; continue
            if cfg.get('entryFilter')=='risk-on' and s.get('btcRegime')!='risk-on': rejects['filter']+=1; continue
            if cfg.get('entryFilter')=='relative-strength' and (s.get('relative1hVsBTC') is None or s['relative1hVsBTC']<=0): rejects['filter']+=1; continue
            stop,target=s.get('stop'),s.get('target'); entry=fill_price(b[1],'buy')
            if not all(isinstance(x,(int,float)) and math.isfinite(x) for x in [stop,target,entry]) or not 0<stop<entry<target:
                rejects['invalid_levels']+=1; continue
            adaptive=exit_kind=='adaptive'
            if cfg.get('originalAdaptiveGates'):
                context=s.get('historicalContext')
                if not context or any(context.get(k)!=s.get(k) for k in ('stop','target')):
                    rejects['missing_or_mismatched_historical_context']+=1; continue
                if context['gate'].get('reason'):
                    rejects['frozen_gate_'+context['gate']['reason']]+=1; continue
            atr=s.get('metrics15m',{}).get('atrPct') if s.get('metrics15m') else None
            stop_pct=100*(entry-stop)/entry
            if adaptive and (not atr or stop_pct<max(.5,.5*atr,.8*100*(2*fee+spread+slip))):
                rejects['adaptive_stop_width']+=1; continue
            loss=entry*(1+fee)-fill_price(stop,'sell',True)*(1-fee)
            reward=fill_price(target,'sell')*(1-fee)-entry*(1+fee)
            if reward/loss<1.5: rejects['net_rr']+=1; continue
            used_risk=sum(p['risk']*p['remaining']/p['quantity'] for p in positions.values())
            risk_budget=min(cfg.get('riskEur',1)*(0.8 if s.get('tradeGrade')=='B' else 1),max(0,cfg.get('openRiskEur',3)-used_risk))
            if cfg.get('portfolio')=='dynamic':
                risk_budget*= (.75 if s.get('btcRegime')=='risk-off' else 1)*(.8 if any(p['family']==s.get('family') for p in positions.values()) else 1)
            # Participation proxy from PREVIOUS bar only. Not historical order-book depth.
            max_notional=min(cfg.get('maxNotionalEur',100),prev[5]*prev[4]*cfg.get('participation',.01))
            quantity=min(max_notional/entry,cash/(entry*(1+fee)),risk_budget/loss)
            if quantity*entry<10: rejects['capital_risk_or_liquidity']+=1; continue
            cash-=quantity*entry*(1+fee)
            positions[m]=dict(market=m,entry=entry,stop=stop,initialStop=stop,target=target,
                quantity=quantity,remaining=quantity,risk=quantity*loss,realized=0.,peak=entry,
                opened=t,gapped=False,lastMark=entry,checkpoint=False,family=s.get('family'))
        # A new position's stop is active during its entry bar.
        for m,p in list(positions.items()):
            b=maps.get(m,{}).get(t)
            if not b:
                p['gapped']=True; dirty=True; missing+=1; continue
            _,o,h,l,c,v=b; p['lastMark']=c
            if l<=p['stop']:
                sell(p,min(o,p['stop']),p['remaining']/p['quantity'],t+STEP,'stop'); continue
            if exit_kind=='target' and h>=p['target']:
                sell(p,p['target'],1,t+STEP,'target'); continue
            if exit_kind=='partial' and not p['checkpoint'] and h>=p['target']:
                sell(p,p['target'],.5,t+STEP,'partial')
                p['checkpoint']=True
            if c>=p['target']: p['checkpoint']=True
            p['peak']=max(p['peak'],c)
            r=p['entry']-p['initialStop']
            past=history.get(m,[])
            if past and past[-1][0]!=t-STEP: past=[]
            hist=past+[b]
            if exit_kind=='adaptive' and len(hist)>=21 and (p['peak']-p['entry'])/r>=2:
                atr5=statistics.mean(max(hist[j][2]-hist[j][3],abs(hist[j][2]-hist[j-1][4]),abs(hist[j][3]-hist[j-1][4])) for j in range(len(hist)-14,len(hist)))
                ema=hist[-20][4]
                for hb in hist[-19:]: ema=2/21*hb[4]+19/21*ema
                gain=(p['peak']-p['entry'])/r
                factor=(2.5 if gain>=5 else 3 if gain>=3 else 3.5)+(.5 if c>=ema else -.25)
                p['stop']=max(p['stop'],min(p['peak']-max(factor*atr5,1.5*r),c-1.5*atr5))
            elif exit_kind in ('trail-1r','trail-1.5r','partial') and p['checkpoint']:
                width=(1.5 if exit_kind=='trail-1.5r' else 1)*r
                p['stop']=max(p['stop'],min(c,p['peak']-width))
            if t+STEP-p['opened']>=cfg.get('maxHoldingHours',48)*3_600_000:
                sell(p,c,p['remaining']/p['quantity'],t+STEP,'time_limit')
        for m in history:
            b=maps[m].get(t)
            if b:
                if history[m] and history[m][-1][0]!=t-STEP: history[m]=[]
                history[m].append(b); history[m]=history[m][-21:]
        mark=cash+sum(p['remaining']*fill_price(p['lastMark'],'sell')*(1-fee) for p in positions.values())
        equity.append(mark)
    result=metrics(trades,equity,initial)
    result.update(rejections=dict(rejects),openPositions=len(positions),missingHeldBars=missing,
        dataStatus='CONTAMINATED_GAPS' if dirty else 'NO_OBSERVED_HOLDING_GAPS',
        censoredPositions=[dict(market=p['market'],openedAt=iso(p['opened']),gapped=p['gapped']) for p in positions.values()],
        assumptions=cfg, trades=trades,
        entryOpportunities=sum(len(x) for x in by_time.values()),
        executedEntries=len(trades)+len(positions),
        executionDataMissingRejections=rejects['missing_entry_or_previous_bar'])
    return result
