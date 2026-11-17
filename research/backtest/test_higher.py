import copy
import math
import unittest
from core import STEP
from higher import aggregate,generate,passive

class HigherTimeframeTests(unittest.TestCase):
    def raw(self,n=100):return [[i*STEP,100.,102.,99.,101.,10.] for i in range(n)]
    def tf(self,n=160,hours=1):
        rows=[]
        for i in range(n):
            c=100+.08*i+3*math.sin(i/5)
            if i==80:c+=8
            rows.append([i*hours*3_600_000,c-.2,c+.5,c-.5,c,1000.+10*i])
        return rows
    def test_1h_and_4h_aggregation_exact(self):
        rows=self.raw(96)
        self.assertEqual(len(aggregate(rows,1,96*STEP)),8)
        r=aggregate(rows,4,96*STEP)
        self.assertEqual(len(r),2);self.assertEqual(r[0][5],480.)
        self.assertEqual(r[0][0],0);self.assertEqual(r[1][0],48*STEP)
    def test_no_incomplete_or_future_higher_candles(self):
        rows=self.raw(96)
        self.assertEqual(len(aggregate(rows,4,47*STEP)),0)
        self.assertEqual(len(aggregate(rows,4,49*STEP)),1)
        self.assertEqual(len(aggregate(rows,1,17*STEP)),1)
    def test_missing_5m_invalidates_entire_higher_bar(self):
        rows=self.raw(96);del rows[3]
        r=aggregate(rows,4,96*STEP)
        self.assertEqual([b[0] for b in r],[48*STEP])
    def test_signal_prefix_is_causal_on_both_timeframes(self):
        for h in (1,4):
            rows=self.tf(hours=h);cut=120*h*3_600_000+1
            small=generate('TEST-EUR',rows[:120],h);full=generate('TEST-EUR',rows,h)
            self.assertGreater(sum(map(len,small.values())),0)
            full={k:[s for s in ss if s['availableAt']<=cut] for k,ss in full.items()}
            self.assertEqual({k:v for k,v in small.items() if v},{k:v for k,v in full.items() if v})
    def test_future_mutations_do_not_change_earlier_signals(self):
        rows=self.tf();future=copy.deepcopy(rows)
        for b in future[120:]:b[1:5]=[x*3 for x in b[1:5]]
        def prior(data):return {k:[s for s in ss if s['availableAt']<=120*3_600_000+1] for k,ss in generate('TEST-EUR',data,1).items()}
        self.assertEqual(prior(rows),prior(future))
    def test_gap_resets_sixty_bar_warmup(self):
        rows=self.tf();rows=[b for b in rows if b[0]!=100*3_600_000]
        self.assertFalse(any(s['availableAt']>101*3_600_000 for ss in generate('TEST-EUR',rows,1).values() for s in ss))
    def test_available_time_is_after_timeframe_close(self):
        ss=generate('TEST-EUR',self.tf(hours=4),4)
        self.assertGreater(sum(map(len,ss.values())),0)
        for rows in ss.values():
            for s in rows:
                self.assertEqual(s['availableAt']%(4*3_600_000),1)
                self.assertGreaterEqual(s['availableAt'],60*4*3_600_000+1)
    def test_buy_hold_flat_price_pays_both_fees(self):
        cfg=dict(capital=300,feePct=.25,spreadPct=0,slipPct=0,participation=.01)
        rows=[[i*STEP,100,100,100,100,100000] for i in range(5)]
        r=passive({'TEST-EUR':rows},cfg,0,5*STEP)
        self.assertAlmostEqual(r['terminalEquityEur'],300*(1-.0025)/(1+.0025))
        self.assertLess(r['netReturnPct'],0)
    def test_buy_hold_missing_data_is_not_clean(self):
        cfg=dict(capital=300,feePct=.25,spreadPct=.1,slipPct=.03,participation=.01)
        rows=[[i*STEP,100,100,100,100,100000] for i in range(5) if i!=3]
        r=passive({'TEST-EUR':rows},cfg,0,5*STEP)
        self.assertEqual(r['dataStatus'],'CONTAMINATED_GAPS');self.assertEqual(r['missingHeldBars'],1)

if __name__=='__main__':unittest.main()
