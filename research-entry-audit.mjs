import fs from 'node:fs';
import {readSignalJournal} from './signal-journal.js';
const trades = ['paper/trades.jsonl','paper/opportunistic-trades.jsonl'].flatMap((p,i)=>fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(l=>({...JSON.parse(l),cohort:i?'opportunistic':'strict'})));
const key=(time,market)=>time+'|'+market;
const wanted=new Set(trades.map(t=>key(t.signalSnapshotAt??t.openedAt,t.market)));
const signals=new Map();
for(const month of ['2026-09','2026-10','2026-11']) for(const bytes of readSignalJournal(month)) for(const line of bytes.toString('utf8').split('\n').filter(Boolean)){
 const r=JSON.parse(line);
 for(const s of r.signals??[]){const k=key(r.snapshotCollectedAt,s.market);if(wanted.has(k))signals.set(k,s);}
}
const rows=trades.map(t=>({...t,s:signals.get(key(t.signalSnapshotAt??t.openedAt,t.market))})).filter(t=>t.s && t.plannedRiskEur>0);
const stats=ts=>{const r=ts.map(t=>t.netPnlEur/t.plannedRiskEur);return {n:r.length,wins:r.filter(x=>x>0).length,meanR:r.length?r.reduce((a,b)=>a+b,0)/r.length:null,pnl:ts.reduce((a,t)=>a+t.netPnlEur,0)}};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const features={
 stopPct:t=>100*(t.s.entry-t.s.stop)/t.s.entry,
 stopAtr:t=>finite(t.s.metrics15m?.atrPct)&&t.s.metrics15m.atrPct>0?100*(t.s.entry-t.s.stop)/t.s.entry/t.s.metrics15m.atrPct:null,
 extensionAtr:t=>{const m=t.s.metrics15m;return m&&m.ema20>0&&m.atrPct>0?(m.last-m.ema20)/m.last*100/m.atrPct:null},
 volume5:t=>t.s.metrics5m?.volumeRatio,
 volume15:t=>t.s.metrics15m?.volumeRatio,
 relative1h:t=>t.s.relative1hVsBTC,
 relative4h:t=>t.s.relative4hVsBTC,
 costPct:t=>t.s.roundTripCostPct,
 netRR:t=>t.s.netRR,
 score:t=>t.s.score
};
const split='2026-11-01';
const report={note:'Exploratory matched executed trades only; no outcomes for rejected signals. Cohorts overlap and are not pooled. November already observed; not independent prospective validation.',total:trades.length,matched:rows.length,cohorts:{}};
for(const cohort of ['strict','opportunistic']){
 const all=rows.filter(t=>t.cohort===cohort);
 const train=all.filter(t=>t.closedAt<split),test=all.filter(t=>t.openedAt>=split);
 const result={total:trades.filter(t=>t.cohort===cohort).length,matched:all.length,train:stats(train),test:stats(test),features:{}};
 for(const [name,f] of Object.entries(features)){
  const values=train.map(f).filter(finite).sort((a,b)=>a-b);
  if(values.length<12)continue;
  const q=[.25,.5,.75].map(p=>values[Math.floor((values.length-1)*p)]);
  const bounds=[-Infinity,...new Set(q),Infinity];
  result.features[name]={missingTrain:train.length-values.length,missingTest:test.filter(t=>!finite(f(t))).length,bins:bounds.slice(0,-1).map((lo,i)=>{const hi=bounds[i+1];const pred=t=>finite(f(t))&&f(t)>=lo&&f(t)<hi;return {lo:Number.isFinite(lo)?lo:null,hi:Number.isFinite(hi)?hi:null,train:stats(train.filter(pred)),test:stats(test.filter(pred))}})};
 }
 report.cohorts[cohort]=result;
}
console.log(JSON.stringify(report,null,2));
