// Experimental subset of strict BUY; never used by live alerts.
export const POLICY=Object.freeze({id:"pullback-recovery-v1",minVolume5:1.25,maxVolume5:2.35,maxExtensionAtr:0.7,minStopPct:0.5,minNetRR:1.5});
export function qualifies(s){
 const m=s?.metrics?.["15m"],v=s?.metrics?.["5m"]?.volumeRatio;
 const nums=[s?.entry,s?.stop,s?.target,s?.netRR,m?.last,m?.ema20,m?.atrPct,v];
 if(!nums.every(Number.isFinite)||!(s.entry>s.stop&&s.stop>0&&s.target>s.entry&&m.last>0&&m.ema20>0&&m.atrPct>0))return false;
 const extension=(m.last-m.ema20)/m.last*100/m.atrPct;
 return s.action==="BUY"&&s.family==="trend pullback"&&["A","B"].includes(s.tradeGrade)&&s.netRR>=POLICY.minNetRR&&
 v>=POLICY.minVolume5&&v<=POLICY.maxVolume5&&Math.abs(extension)<=POLICY.maxExtensionAtr&&100*(s.entry-s.stop)/s.entry>=POLICY.minStopPct;
}
export function filteredSignals(doc){
 return {...doc,signals:(doc.signals??[]).map(s=>qualifies(s)?s:{...s,action:"WAIT"}),actionable:(doc.actionable??[]).filter(qualifies)};
}
