import assert from "node:assert/strict";
import {qualifies,filteredSignals} from "./pullback-shadow-lib.js";
const s={market:"TEST-EUR",action:"BUY",family:"trend pullback",tradeGrade:"A",entry:100,stop:99,target:104,netRR:2,metrics:{"5m":{volumeRatio:1.5},"15m":{last:100,ema20:99.5,atrPct:1}}};
assert.equal(qualifies(s),true);
for(const x of [{action:"WAIT"},{family:"confirmed breakout"},{tradeGrade:"C"},{netRR:1.49},{stop:99.9},{metrics:{}},{metrics:{...s.metrics,"5m":{volumeRatio:3}}},{metrics:{...s.metrics,"15m":{last:100,ema20:98,atrPct:1}}}])assert.equal(qualifies({...s,...x}),false);
const bad={...s,market:"BAD-EUR",action:"WAIT"};const doc={signals:[s,bad],actionable:[s]};
assert.deepEqual(filteredSignals(doc).actionable,[s]);assert.equal(doc.signals[0].action,"BUY");assert.equal(filteredSignals({signals:[{...s,family:"confirmed breakout"}]}).signals[0].action,"WAIT");
console.log("pullback shadow qualification: OK");
