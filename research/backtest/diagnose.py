"""Deterministic accounting/excursion diagnosis of existing closed paper trades."""
import argparse
import collections
import json
import pathlib
import statistics
from core import ms
from run import write


def read_lines(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def summarize(rows):
    cost_rows=[r for r in rows if r.get('amountEur') is not None and r.get('grossReturnPct') is not None and r.get('roundTripCostPct') is not None]
    excursions=[r for r in rows if isinstance(r.get('mfePctGross'),(int,float))]
    # Cost arithmetic on the SAME executed trades; not a simulation of a cost-free policy.
    gross=sum(r['amountEur']*r['grossReturnPct']/100 for r in cost_rows)
    exchange_fees=sum(r['amountEur']*(.4 if r.get('family')=='trend pullback' else .5)/100 for r in cost_rows)
    buffer=sum(r['amountEur']*.03/100 for r in cost_rows)
    costs=sum(r['amountEur']*r['roundTripCostPct']/100 for r in cost_rows)
    net=sum(r['netPnlEur'] for r in cost_rows)
    structure=[(r,100*(r['entry']-r['stop'])/r['entry']) for r in rows if r.get('entry',0)>r.get('stop',0)>0]
    return dict(trades=len(rows),netPnlEur=sum(r['netPnlEur'] for r in rows),
        wins=sum(r['netPnlEur']>0 for r in rows),
        meanNetR=statistics.mean(r['netPnlEur']/r['plannedRiskEur'] for r in rows if r.get('plannedRiskEur',0)>0) if rows else None,
        accounting=dict(sample=len(cost_rows),grossEur=gross,modeledCostEur=costs,netEur=net,modeledExchangeFeeEur=exchange_fees,modeledEntryBufferEur=buffer,impliedSpreadEur=costs-exchange_fees-buffer,
            identityResidualEur=gross-costs-net,
            grossWinningButNetNonpositive=sum(r['grossReturnPct']>0 and r['netPnlEur']<=0 for r in cost_rows)),
        stops=dict(sample=len(structure),belowHalfPercent=sum(width<.5 for r,width in structure),
            modeledRoundTripCostAtLeastStructuralStop=sum((r.get('roundTripCostPct') or 0)>=width for r,width in structure),
            medianWidthPct=statistics.median(width for _,width in structure) if structure else None),
        excursions=dict(sample=len(excursions),losersReachedOneStructuralR=sum(r['netPnlEur']<0 and r.get('mfeStructuralR',0)>=1 for r in excursions),
            medianMfePct=statistics.median(r['mfePctGross'] for r in excursions) if excursions else None,
            note='Observed intrabar maximum only, no proof of achievable exit; missing excursion fields excluded explicitly'),
        exitReasons=dict(collections.Counter(r.get('exitReason','UNKNOWN') for r in rows)))


def diagnose(root):
    trades=read_lines(root/'paper/trades.jsonl')
    registered=ms(json.loads((root/'experiment/protocol.json').read_text())['prospectiveStartAt'])
    cohorts=dict(all=trades,registered=[r for r in trades if ms(r['openedAt'])>=registered],
        november=[r for r in trades if ms(r['openedAt'])>=ms('2026-11-01T00:00:00Z')])
    out=dict(cohorts={k:summarize(v) for k,v in cohorts.items()},
        byFamily={k:summarize([r for r in trades if r.get('family')==k]) for k in sorted({r.get('family','UNKNOWN') for r in trades})},
        limits=['Arithmetic on original simulated trades, not actual account PnL.',
            'Gross PnL excludes modeled costs for the same fills; removing costs could change future entries/sizing, so this is not a cost-free strategy backtest.',
            'Fee decomposition follows frozen analysis-engine assumptions: trend pullback maker 0.15% plus taker 0.25%; other families taker/taker 0.50%; entry buffer 0.03%; remainder is modeled spread, not exchange receipts.',
            'No independent causal attribution of entries, stop widths or exit timing is possible from the ledger alone.',
            'Intrabar MFE and MAE may be ambiguous on exit candles and are not attainable exit prices.',
            'Ledger does not provide verified continuous execution data for every trade; no implied clean-data certification.'])
    exit_path=root/'exit-shadow/trades.jsonl'
    if exit_path.exists():
        pairs=collections.defaultdict(list)
        for r in read_lines(exit_path):
            if r.get('baselineNetR') is not None:pairs[r['policyId']].append(r['netR']-r['baselineNetR'])
        out['pairedExitDeltas']={k:dict(n=len(v),meanDeltaR=statistics.mean(v)) for k,v in pairs.items()}
    return out


def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True)
    a=p.parse_args();out=diagnose(a.root);write(a.out/'diagnosis.json',out)
    text=['# Diagnostic des pertes — données figées au 4 novembre 2026','',
        '| Échantillon | Trades | PnL brut € | Coûts modélisés € | Net € | Gagnants bruts devenus non positifs nets |',
        '|---|---:|---:|---:|---:|---:|']
    for k,r in out['cohorts'].items():
        c=r['accounting'];text.append(f"| {k} | {r['trades']} | {c['grossEur']:.3f} | {c['modeledCostEur']:.3f} | {r['netPnlEur']:.3f} | {c['grossWinningButNetNonpositive']} |")
    text+=['','Les colonnes brutes et de coûts portent uniquement sur les lignes disposant de tous les champs nécessaires. Les tailles des sous-échantillons et le résidu comptable figurent dans diagnosis.json.','',
        '## Limites','']+['- '+x for x in out['limits']]
    (a.out/'DIAGNOSIS.md').write_text('\n'.join(text)+'\n');print('LOSS_DIAGNOSIS',json.dumps(out))
if __name__=='__main__':main()
