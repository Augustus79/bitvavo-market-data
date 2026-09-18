import assert from "node:assert/strict";
import { closed5mBars, newState, processPaperState } from "./paper-trader.js";

const t0 = Date.parse("2026-09-18T10:00:00Z");
const raw = [
  [t0 + 10*60*1000, "100", "101", "99", "100", "1"],
  [t0 + 5*60*1000, "100", "105", "95", "102", "1"],
  [t0, "100", "101", "99", "100", "1"]
];
assert.equal(closed5mBars(raw, t0 + 10*60*1000).length, 2, "open candle must be excluded");

const buy = {
  market:"AAA-EUR", action:"BUY", family:"trend pullback", tradeGrade:"A", score:9,
  entry:100, stop:98, target:104, roundTripCostPct:0.5, netRR:1.5,
  suggestedRiskEur:1.25, suggestedAmountEur:50, btcRegime:"risk-on"
};
let snapshot={collectedAt:"2026-09-18T10:10:00Z",deep:{"AAA-EUR":{candles:{"5m":raw}}}};
let r=processPaperState(newState(),{signals:[buy],actionable:[buy],btcRegime:"risk-on"},snapshot);
assert.equal(r.state.openPositions.length,1,"BUY episode should open one paper position");
assert.equal(r.state.openPositions[0].amountEur,50);

// Same BUY episode must not duplicate.
snapshot={collectedAt:"2026-09-18T10:15:00Z",deep:{"AAA-EUR":{candles:{"5m":[
  [t0+10*60*1000,"100","101","99","100","1"], ...raw
]}}}};
r=processPaperState(r.state,{signals:[buy],actionable:[buy]},snapshot);
assert.equal(r.state.openPositions.length,1,"persistent BUY must not duplicate");

// Target hit on a later closed candle.
snapshot={collectedAt:"2026-09-18T10:20:00Z",deep:{"AAA-EUR":{candles:{"5m":[
  [t0+15*60*1000,"100","104.5","99.5","104","1"],
  [t0+10*60*1000,"100","101","99","100","1"], ...raw
]}}}};
r=processPaperState(r.state,{signals:[{...buy,action:"WAIT"}],actionable:[]},snapshot);
assert.equal(r.state.openPositions.length,0);
assert.equal(r.closedTrades.length,1);
assert.equal(r.closedTrades[0].exitReason,"TARGET");
assert.ok(r.closedTrades[0].netPnlEur>0);

// Same candle touching stop and target resolves conservatively to STOP.
let s=newState();
const b2={...buy,market:"BBB-EUR"};
snapshot={collectedAt:"2026-09-18T10:10:00Z",deep:{"BBB-EUR":{candles:{"5m":raw}}}};
r=processPaperState(s,{signals:[b2],actionable:[b2]},snapshot);
snapshot={collectedAt:"2026-09-18T10:15:00Z",deep:{"BBB-EUR":{candles:{"5m":[
  [t0+10*60*1000,"100","105","97","100","1"], ...raw
]}}}};
r=processPaperState(r.state,{signals:[{...b2,action:"WAIT"}],actionable:[]},snapshot);
assert.equal(r.closedTrades[0].exitReason,"STOP");
assert.equal(r.closedTrades[0].ambiguousSameCandle,true);

console.log("paper-trader v1 tests: OK");
