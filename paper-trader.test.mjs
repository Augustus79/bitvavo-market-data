import assert from "node:assert/strict";
import {
  STRICT_POLICY,
  OPPORTUNISTIC_POLICY,
  closed5mBars,
  newState,
  processPaperState,
  requiredEntryForNetRR
} from "./paper-trader.js";

const t0 = Date.parse("2026-09-18T10:00:00Z");
const raw = [
  [t0 + 10*60*1000, "100", "101", "99", "100", "1"],
  [t0 + 5*60*1000, "100", "105", "95", "102", "1"],
  [t0, "100", "101", "99", "100", "1"]
];
assert.equal(closed5mBars(raw, t0 + 10*60*1000).length, 2);

const quality = {"5m":{ok:true},"15m":{ok:true},"1h":{ok:true}};
const buy = {
  market:"AAA-EUR", action:"BUY", family:"trend pullback", tradeGrade:"A", score:9,
  trigger:true, dataQuality:quality, entry:100, stop:98, target:104, riskPct:2,
  roundTripCostPct:0.5, netRR:1.5, suggestedRiskEur:1.25, suggestedAmountEur:50,
  btcRegime:"risk-on", metrics:{"15m":{atr:2}}
};

let snapshot={collectedAt:"2026-09-18T10:10:00Z",deep:{"AAA-EUR":{candles:{"5m":raw}}}};
let r=processPaperState(newState(STRICT_POLICY),{signals:[buy],actionable:[buy]},snapshot,STRICT_POLICY);
assert.equal(r.state.openPositions.length,1);
assert.equal(r.state.openPositions[0].amountEur,50);

snapshot={collectedAt:"2026-09-18T10:15:00Z",deep:{"AAA-EUR":{candles:{"5m":[
  [t0+10*60*1000,"100","101","99","100","1"], ...raw
]}}}};
r=processPaperState(r.state,{signals:[buy],actionable:[buy]},snapshot,STRICT_POLICY);
assert.equal(r.state.openPositions.length,1);

snapshot={collectedAt:"2026-09-18T10:20:00Z",deep:{"AAA-EUR":{candles:{"5m":[
  [t0+15*60*1000,"100","104.5","99.5","104","1"],
  [t0+10*60*1000,"100","101","99","100","1"], ...raw
]}}}};
r=processPaperState(r.state,{signals:[{...buy,action:"WAIT"}],actionable:[]},snapshot,STRICT_POLICY);
assert.equal(r.state.openPositions.length,0);
assert.equal(r.closedTrades[0].exitReason,"TARGET");
assert.ok(r.closedTrades[0].netPnlEur>0);

let s=newState(STRICT_POLICY);
const b2={...buy,market:"BBB-EUR"};
snapshot={collectedAt:"2026-09-18T10:10:00Z",deep:{"BBB-EUR":{candles:{"5m":raw}}}};
r=processPaperState(s,{signals:[b2],actionable:[b2]},snapshot,STRICT_POLICY);
snapshot={collectedAt:"2026-09-18T10:15:00Z",deep:{"BBB-EUR":{candles:{"5m":[
  [t0+10*60*1000,"100","105","97","100","1"], ...raw
]}}}};
r=processPaperState(r.state,{signals:[{...b2,action:"WAIT"}],actionable:[]},snapshot,STRICT_POLICY);
assert.equal(r.closedTrades[0].exitReason,"STOP");
assert.equal(r.closedTrades[0].ambiguousSameCandle,true);

const oppDirect={
  ...buy, market:"CCC-EUR", action:"WAIT", netRR:1.30, suggestedAmountEur:null,
  blockers:["net structural R/R below threshold"], entry:100, stop:98, target:103.75
};
snapshot={collectedAt:"2026-09-18T10:10:00Z",deep:{"CCC-EUR":{candles:{"5m":raw}}}};
r=processPaperState(newState(OPPORTUNISTIC_POLICY),{signals:[oppDirect],actionable:[]},snapshot,OPPORTUNISTIC_POLICY);
assert.equal(r.state.openPositions.length,1);
assert.equal(r.state.openPositions[0].cohort,"opportunistic");

const e=requiredEntryForNetRR(98,104,0.5,1.5);
const netReward=100*(104-e)/e-0.5;
const netRisk=100*(e-98)/e+0.5;
assert.ok(Math.abs(netReward/netRisk-1.5)<1e-9);

const oppRetest={
  ...buy, market:"DDD-EUR", action:"WAIT", netRR:1.0, suggestedAmountEur:null,
  entry:100, stop:98, target:103, blockers:["net structural R/R below threshold"],
  metrics:{"15m":{atr:2}}
};
snapshot={collectedAt:"2026-09-18T10:10:00Z",deep:{"DDD-EUR":{candles:{"5m":raw}}}};
r=processPaperState(newState(OPPORTUNISTIC_POLICY),{signals:[oppRetest],actionable:[]},snapshot,OPPORTUNISTIC_POLICY);
assert.equal(r.state.pendingEntries.length,1);
const limit=r.state.pendingEntries[0].limitEntry;
assert.ok(limit<100 && limit>98);

snapshot={collectedAt:"2026-09-18T10:15:00Z",deep:{"DDD-EUR":{candles:{"5m":[
  [t0+10*60*1000,String(limit+0.3),String(limit+0.5),String(limit-0.05),String(limit+0.1),"1"],
  ...raw
]}}}};
r=processPaperState(r.state,{signals:[{...oppRetest,trigger:false}],actionable:[]},snapshot,OPPORTUNISTIC_POLICY);
assert.equal(r.state.pendingEntries.length,0);
assert.equal(r.state.openPositions.length,1);
assert.equal(r.state.openPositions[0].entryMode,"retest-limit");
assert.ok(r.state.openPositions[0].initialNetRR>=1.49);

console.log("paper-trader v2 cohort tests: OK");
