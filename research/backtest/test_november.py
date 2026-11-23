import copy
import json
import math
import pathlib
import tempfile
import unittest
from core import STEP,digest
from diagnose import summarize
from independent import aggregate_hours,independent_signals

class NovemberTests(unittest.TestCase):
    def rows(self,n=800):
        rows=[]
        for i in range(n):
            c=100+i*.03+math.sin(i/8)
            rows.append([i*STEP,c-.1,c+.3,c-.3,c,1000.])
        return rows
    def test_hour_requires_all_twelve_bars(self):
        rows=self.rows(24);del rows[4]
        result=aggregate_hours(rows)
        self.assertEqual([b[0] for b in result],[12*STEP])
    def test_hour_ohlcv_exact(self):
        rows=self.rows(12);h=aggregate_hours(rows)[0]
        self.assertEqual(h[1],rows[0][1]);self.assertEqual(h[4],rows[-1][4]);self.assertEqual(h[5],12000.)
    def test_prefix_causality(self):
        rows=self.rows(1000)
        prefix=independent_signals('TEST-EUR',rows[:800])
        self.assertGreater(sum(map(len,prefix.values())),0)
        full=independent_signals('TEST-EUR',rows)
        limited={name:[s for s in ss if s['availableAt']<=800*STEP+1] for name,ss in full.items()}
        self.assertEqual({k:v for k,v in prefix.items() if v},{k:v for k,v in limited.items() if v})
    def test_future_mutation_cannot_change_prior_entries(self):
        rows=self.rows(1000);other=copy.deepcopy(rows)
        for b in other[850:]:b[1:5]=[x*2 for x in b[1:5]]
        def prior(data):return {k:[s for s in ss if s['availableAt']<850*STEP] for k,ss in independent_signals('TEST-EUR',data).items()}
        self.assertEqual(prior(rows),prior(other))
    def test_gap_resets_warmup(self):
        rows=self.rows(1000);rows=[b for b in rows if b[0]!=700*STEP]
        ss=independent_signals('TEST-EUR',rows)
        self.assertFalse(any(s['availableAt']>701*STEP for v in ss.values() for s in v))
    def test_fixed_trade_cost_identity(self):
        r=dict(entry=100,stop=99,amountEur=100,grossReturnPct=.4,roundTripCostPct=.6,netPnlEur=-.2,plannedRiskEur=1,exitReason='STOP')
        d=summarize([r]);self.assertAlmostEqual(d['accounting']['identityResidualEur'],0)
        self.assertEqual(d['accounting']['grossWinningButNetNonpositive'],1)
        self.assertEqual(d['excursions']['sample'],0)
    def test_candle_vintage_precedence_is_explicit_and_audited(self):
        import run
        with tempfile.TemporaryDirectory() as td:
            root=pathlib.Path(td);cache=root/'cache';cache.mkdir()
            (root/'snapshot.json').write_text(json.dumps(dict(collectedAt='2026-11-04T00:00:00Z',deep={})))
            for name,close in [('original.json',100),('revised.json',101)]:
                rows=[[0,100,102,99,close,10]]
                (cache/name).write_text(json.dumps(dict(schema='public-candles-cache-v1',market='TEST-EUR',bars=rows,sha256=digest(json.dumps(rows,separators=(',',':')).encode()))))
            d=json.loads((cache/'original.json').read_text())
            (root/'baseline-price-vintage.json').write_text(json.dumps(dict(files={'original.json':d['sha256']})))
            saved=run.HERE
            try:
                run.HERE=root
                chosen=run.load_prices(root,cache)
                self.assertEqual(chosen['TEST-EUR'][0][4],100)
                audit=json.loads((cache/'price-revisions.json').read_text())
                self.assertEqual(audit['conflictingMarketBars'],1)
                self.assertEqual(audit['conflicts'][0]['alternatives'][0]['bar'][4],101)
                (root/'baseline-price-vintage.json').unlink()
                with self.assertRaises(ValueError):run.load_prices(root,cache)
            finally:run.HERE=saved
    def test_signal_available_only_after_completed_bar(self):
        ss=independent_signals('TEST-EUR',self.rows(1000))
        self.assertGreater(sum(map(len,ss.values())),0)
        for signals in ss.values():
            for s in signals:
                self.assertEqual(s['availableAt']%STEP,1)
                self.assertGreaterEqual(s['availableAt'],600*STEP+1)

if __name__=='__main__':unittest.main()
