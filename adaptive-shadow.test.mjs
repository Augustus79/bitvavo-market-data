import assert from "node:assert/strict";
import { ADAPTIVE_POLICY,newAdaptiveState,processAdaptiveShadow,qualifyEntry } from "./adaptive-shadow-lib.js";
const t0=Date.parse("2026-10-27T12:00:00Z");
const bar=(i,o,h,l,c)=>[t0+i*300000,o,h,l,c,20];
const mk=rows=>rows.map((x,i)=>bar(i,...x)).reverse();
const stable=Array.from({length:30},()=>[100,100.2,99.9,100]);
const sig=(extra={})=>({market:"AAA-EUR",action:"BUY",entry:100,stop:99.4,target:103,
  tradeGrade:"A",family:"momentum/relative strength",
  metrics:{book:{bidDepth10:5000},"15m":{atrPct:1}},
  dataQuality:{"5m":{ok:true},"15m":{ok:true},"1h":{ok:true}},...extra});
const frame=(i,rows,signal=sig(),stricts=[])=>{
  const collectedAt=new Date(t0+(i+1)*300000+10000).toISOString();
  return {snapshot:{collectedAt,deep:{"AAA-EUR":{
    ticker:{ask:100,spreadPct:0.03,volumeQuote:1000000},
    candles:{"5m":mk(rows)}
  }}},signals:{snapshotCollectedAt:collectedAt,signals:[signal]},stricts};
};
const run=(state,f)=>processAdaptiveShadow(state,f.stricts,f.signals,f.snapshot);
let f=frame(29,stable,sig({action:"WAIT"})),r=run(newAdaptiveState(),f);
assert.equal(r.opened.length,0);
let next=[...stable,[100,100.2,99.9,100.1]];
f=frame(30,next);
f.stricts=[{id:"strict|AAA|one",openedAt:f.snapshot.collectedAt,market:"AAA-EUR",
  family:"momentum/relative strength",btcRegimeAtEntry:"neutral"}];
r=run(r.state,f);
assert.equal(r.opened.length,1);
assert.equal(r.state.openPositions[0].currentStop,99.4);
assert.equal(run(r.state,f).opened.length,0);
next.push([100.1,104,99.9,103.3]);
r=run(r.state,frame(31,next));
assert.equal(r.closedTrades.length,0);
assert.equal(r.state.openPositions[0].targetCheckpointReached,true);
assert.equal(r.state.openPositions[0].trailingActivated,true);
assert.ok(r.state.openPositions[0].currentStop>99.4);
assert.ok(r.state.openPositions[0].currentStop<103.3);
const lastStop=r.state.openPositions[0].currentStop;
next.push([103.3,103.7,103,103.4]);
r=run(r.state,frame(32,next));
assert.equal(r.closedTrades.length,0);
assert.ok(r.state.openPositions[0].currentStop>=lastStop);
next.push([103.4,103.5,98.9,99]);
r=run(r.state,frame(33,next));
assert.equal(r.closedTrades.length,1);
assert.equal(r.state.openPositions.length,0);
assert.ok(r.closedTrades[0].exitPrice<r.closedTrades[0].stopAtExit);
assert.equal(r.closedTrades[0].dataGapped,false);
const bad=qualifyEntry(sig({stop:99.99}),frame(29,stable).snapshot,newAdaptiveState());
assert.equal(bad.reason,"STOP_TOO_NARROW");
const lowQuality=qualifyEntry(sig({dataQuality:{"5m":{ok:false},"15m":{ok:true},"1h":{ok:true}}}),
  frame(29,stable).snapshot,newAdaptiveState());
assert.equal(lowQuality.reason,"INVALID_STRICT_SIGNAL_OR_DATA");
const noCap=newAdaptiveState();
let a=run(noCap,frame(29,stable,sig({action:"WAIT"}))).state;
let entry=frame(30,[...stable,[100,100.2,99.9,100]]);
entry.stricts=[{id:"strict|AAA|two",openedAt:entry.snapshot.collectedAt,
  market:"AAA-EUR",family:"confirmed breakout",btcRegimeAtEntry:"risk-on"}];
a=run(a,entry).state;
let both=[...stable,[100,100.2,99.9,100],[100,104,98.7,103.9]];
r=run(a,frame(31,both));
assert.equal(r.closedTrades.length,1);
assert.equal(r.closedTrades[0].exitReason,"INITIAL_STOP");
assert.equal(ADAPTIVE_POLICY.id,"adaptive-runner-v1");

// Three independent concurrent positions, even without strict-paper slots.
const names=["AAA-EUR","BBB-EUR","CCC-EUR","DDD-EUR"];
const waitSignals=names.map(m=>sig({market:m,action:"WAIT"}));
const multiBars=[...stable,[100,100.2,99.9,100.1]];
function multiFrame(i,signalRows,withMissing=false) {
  const collectedAt=new Date(t0+(i+1)*300000+10000).toISOString();
  const markets=Object.fromEntries(names.map(m=>[m,{
    ticker:{ask:100,spreadPct:0.03,volumeQuote:1000000},
    candles:{"5m":mk(multiBars)}
  }]));
  if(withMissing) delete markets["AAA-EUR"];
  return {snapshot:{collectedAt,deep:markets},
    signals:{snapshotCollectedAt:collectedAt,signals:signalRows},
    stricts:[]};
}
let multi=run(newAdaptiveState(),multiFrame(29,waitSignals)).state;
let mres=run(multi,multiFrame(30,names.map(m=>sig({market:m}))));
assert.equal(ADAPTIVE_POLICY.maxPositions,3);
assert.equal(mres.opened.length,3);
assert.equal(mres.state.openPositions.length,3);
assert.equal(mres.skipped.length,1);
assert.equal(mres.skipped[0].reason,"CAPACITY");
assert.equal(mres.state.stats.opened,3);
assert.ok(mres.opened.every(x=>x.strictPositionId===null));
assert.ok(mres.opened.every(x=>x.initialRiskEur<=1.0000001));
assert.ok(mres.opened.reduce((s,x)=>s+x.initialRiskEur,0)<=3.0000001);
assert.ok(mres.state.openPositions.reduce((s,x)=>s+x.amountEur,0)<=300.00001);
// Idempotence and rising-edge gating on continuously active BUY signals.
assert.equal(run(mres.state,multiFrame(30,names.map(m=>sig({market:m})))).opened.length,0);
mres=run(mres.state,multiFrame(31,names.map(m=>sig({market:m}))));
assert.equal(mres.opened.length,0);
assert.equal(mres.state.openPositions.length,3);
// A signal returning after WAIT still cannot exceed the three-position limit.
mres=run(mres.state,multiFrame(32,names.map(m=>sig({market:m,action:"WAIT"}))));
mres=run(mres.state,multiFrame(33,names.map(m=>sig({market:m}))));
assert.equal(mres.opened.length,0);
assert.equal(mres.state.openPositions.length,3);
assert.equal(mres.skipped.filter(x=>x.reason==="CAPACITY").length,1);
assert.equal(mres.skipped.filter(x=>x.reason==="MARKET_ALREADY_OPEN").length,3);
// Limit never authorizes entries with missing deep-market data.
const missingState=run(newAdaptiveState(),multiFrame(29,waitSignals)).state;
const missingResult=run(missingState,multiFrame(30,names.map(m=>sig({market:m})),true));
assert.ok(missingResult.state.openPositions.length<=3);
assert.equal(missingResult.skipped.find(x=>x.market==="AAA-EUR")?.reason,"INVALID_STRICT_SIGNAL_OR_DATA");

console.log("adaptive-shadow.test.mjs OK");
