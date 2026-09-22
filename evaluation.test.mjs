import assert from "node:assert/strict";
import { meanCi95, tradeStats, decisionFromStats, stabilitySummary } from "./evaluation-lib.js";

const wins = Array.from({length:100},(_,i)=>({
  netPnlEur: i%3===0 ? -1 : 2,
  plannedRiskEur:1
}));
const s=tradeStats(wins);
assert.equal(s.trades,100);
assert.ok(s.meanNetR>0);
assert.equal(decisionFromStats(s,true,{
  primaryHypothesis:{firstDecisionCheckpointTrades:50,supportCheckpointTrades:100}
}),"SUPPORTED");

const losses=Array.from({length:50},()=>({netPnlEur:-1,plannedRiskEur:1}));
const ls=tradeStats(losses);
assert.equal(decisionFromStats(ls,true,{
  primaryHypothesis:{firstDecisionCheckpointTrades:50,supportCheckpointTrades:100}
}),"FALSIFIED");
assert.equal(decisionFromStats(ls,false,{
  primaryHypothesis:{firstDecisionCheckpointTrades:50,supportCheckpointTrades:100}
}),"PROTOCOL_CHANGED");

const small=tradeStats([{netPnlEur:1,plannedRiskEur:1}]);
assert.equal(decisionFromStats(small,true,{
  primaryHypothesis:{firstDecisionCheckpointTrades:50,supportCheckpointTrades:100}
}),"INSUFFICIENT_DATA");
assert.equal(meanCi95([1]).low,null);

const base=Date.parse("2026-09-22T00:00:00Z");
const rows=Array.from({length:73},(_,i)=>({
  snapshotCollectedAt:new Date(base+i*300000).toISOString(),
  pipelineLatencySec:20,
  snapshotFresh:true
}));
const stab=stabilitySummary(rows,{
  snapshotIntervalSec:300,
  minimumObservationWindowHours:6,
  minimumCoveragePct:95,
  maximumP95PipelineLatencySec:120,
  maximumStaleRuns:0
});
assert.equal(stab.status,"HEALTHY");
assert.equal(stab.gapCount,0);

console.log("evaluation tests: OK");
