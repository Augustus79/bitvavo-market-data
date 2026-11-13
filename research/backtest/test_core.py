import copy
import gzip
import json
import pathlib
import tempfile
import unittest
from core import STEP, digest, load_journal, metrics, signals_from, simulate, validate_bars

class ResearchTests(unittest.TestCase):
    def s(self,t=0,**kw):
        return dict(market='TEST-EUR',availableAt=t,stop=90.,target=130.,tradeGrade='A',score=9.,family='breakout',**kw)
    def bars(self,changes=None,n=8):
        changes=changes or {}
        return {'TEST-EUR':[[i*STEP,*changes.get(i,[100.,101.,99.,100.,1000.])] for i in range(n)]}
    def sim(self,signal=None,bars=None,cfg=None,n=8):
        return simulate([signal or self.s()],bars or self.bars(),dict(feePct=0,spreadPct=0,slipPct=0,stopSlipPct=0,**(cfg or {})),0,n*STEP)
    def test_next_full_bar(self):
        r=self.sim(signal=self.s(1),bars=self.bars({0:[100,200,1,100,1000],1:[100,101,89,90,1000]}))
        self.assertEqual(r['closedTrades'],1)
        self.assertIn('00:05:00',r['trades'][0]['openedAt'])
    def test_stop_first_and_gap_price(self):
        r=self.sim(bars=self.bars({1:[85,140,80,100,1000]}))
        # Invalid gap through stop prevents entry rather than creating a short-risk position.
        self.assertEqual(r['closedTrades'],0)
        r=self.sim(bars=self.bars({2:[85,140,80,100,1000]}))
        self.assertEqual(r['trades'][0]['reason'],'stop')
        self.assertAlmostEqual(r['trades'][0]['netPnlEur'],-1.5)
    def test_same_bar_stop_beats_target(self):
        r=self.sim(bars=self.bars({2:[100,140,80,110,1000]}))
        self.assertEqual(r['trades'][0]['reason'],'stop')
        self.assertAlmostEqual(r['trades'][0]['netPnlEur'],-1.)
    def test_costs_both_sides(self):
        bars=self.bars({2:[100,135,99,130,1000]})
        a=self.sim(bars=bars)
        b=simulate([self.s()],bars,dict(feePct=.25,spreadPct=.1,slipPct=.03,stopSlipPct=.4),0,8*STEP)
        self.assertLess(b['netPnlEur'],a['netPnlEur'])
    def test_no_fill_bar_volume_lookahead(self):
        a=self.sim(bars=self.bars({0:[100,101,99,100,0],1:[100,140,99,130,1e9]}))
        self.assertEqual(a['closedTrades'],0)
        self.assertEqual(a['rejections']['capital_risk_or_liquidity'],1)
    def test_trailing_applies_next_bar(self):
        bars=self.bars({2:[100,145,91,140,1000],3:[140,141,125,130,1000]})
        r=self.sim(bars=bars,cfg=dict(exit='trail-1r'))
        self.assertEqual(r['closedTrades'],1)
        self.assertIn('00:20:00',r['trades'][0]['closedAt'])
        self.assertAlmostEqual(r['netPnlEur'],3.)
    def test_missing_held_bar_contaminates(self):
        bs=self.bars();bs['TEST-EUR']=[b for b in bs['TEST-EUR'] if b[0]!=2*STEP]
        r=self.sim(bars=bs)
        self.assertEqual(r['dataStatus'],'CONTAMINATED_GAPS')
    def test_future_prices_do_not_change_past(self):
        a=self.bars(n=20); b=copy.deepcopy(a);b['TEST-EUR'][15]=[15*STEP,100,200,1,100,1000]
        x=self.sim(bars=a,n=10);y=self.sim(bars=b,n=10)
        self.assertEqual(x,y)
    def test_capacity_and_cash(self):
        bars=self.bars();bars['TWO-EUR']=bars['TEST-EUR']
        r=simulate([self.s(),dict(self.s(),market='TWO-EUR')],bars,dict(maxPositions=1,feePct=0,spreadPct=0,slipPct=0,stopSlipPct=0),0,8*STEP)
        self.assertEqual(r['openPositions'],1);self.assertEqual(r['rejections']['capacity'],1)
        self.assertGreaterEqual(r['terminalEquityEur'],0)
    def test_metrics_marked_drawdown(self):
        self.assertAlmostEqual(metrics([], [300,330,270],300)['maxMarkedDrawdownPct'],100*60/330)
    def test_validate_ohlcv(self):
        with self.assertRaises(ValueError): validate_bars([[0,100,99,90,100,1]])
        with self.assertRaises(ValueError): validate_bars([[1,100,101,99,100,1]])
        with self.assertRaises(ValueError): validate_bars([[0,100,101,99,100,float('nan')]])
        with self.assertRaises(ValueError): validate_bars([[0,100,101,99,100,1],[0,100,102,99,100,1]])
    def test_integrity_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);d=root/'history/signals-2026-10';d.mkdir(parents=True)
            raw=b'{"snapshotCollectedAt":"2026-10-01T00:00:00Z","signals":[]}\n'
            (d/'000001.jsonl.gz').write_bytes(gzip.compress(raw));(d/'000002.jsonl').write_bytes(b'')
            (d/'manifest.json').write_text(json.dumps(dict(schemaVersion=1,activePart=2,sealed=[dict(file='000001.jsonl.gz',bytes=len(raw),sha256=digest(raw))])))
            self.assertEqual(load_journal(root)[1]['snapshots'],1)
            (d/'000001.jsonl.gz').write_bytes(gzip.compress(raw+b'\n'))
            with self.assertRaises(ValueError): load_journal(root)
    def test_buy_edge_requires_prior_observation(self):
        def row(at,action):return dict(snapshotCollectedAt=at,snapshotFresh=True,signals=[dict(market='TEST-EUR',action=action,dataQualityOk=True)])
        r=[row('2026-10-01T00:00:00Z','BUY'),row('2026-10-01T00:05:00Z','WAIT'),row('2026-10-01T00:10:00Z','BUY')]
        self.assertEqual(len(signals_from(r)),1)
    def test_original_gate_requires_exact_context(self):
        r=self.sim(cfg=dict(originalAdaptiveGates=True))
        self.assertEqual(r['rejections']['missing_or_mismatched_historical_context'],1)
        signal=self.s();signal['historicalContext']=dict(stop=90,target=130,gate=dict(reason='LIQUIDITY_OR_SPREAD'))
        r=self.sim(signal=signal,cfg=dict(originalAdaptiveGates=True))
        self.assertEqual(r['rejections']['frozen_gate_LIQUIDITY_OR_SPREAD'],1)
    def test_original_gate_context_mismatch_rejected(self):
        signal=self.s();signal['historicalContext']=dict(stop=91,target=130,gate={})
        r=self.sim(signal=signal,cfg=dict(originalAdaptiveGates=True))
        self.assertEqual(r['executedEntries'],0)
    def test_reproducible(self):self.assertEqual(self.sim(),self.sim())

if __name__=='__main__':unittest.main()
