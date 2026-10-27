import fs from "node:fs";
import { ADAPTIVE_POLICY, newAdaptiveState, processAdaptiveShadow } from "./adaptive-shadow-lib.js";
const dir="adaptive-shadow";
fs.mkdirSync(dir,{recursive:true});
const load=(path,fallback=null)=>fs.existsSync(path)?JSON.parse(fs.readFileSync(path,"utf8")):fallback;
const lines=path=>fs.existsSync(path)?fs.readFileSync(path,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const write=(path,obj)=>fs.writeFileSync(path,JSON.stringify(obj,null,2)+"\n");
const append=(path,a)=>{if(a.length)fs.appendFileSync(path,a.map(x=>JSON.stringify(x)).join("\n")+"\n");};
const snapshot=load("snapshot.json"),signals=load("signals.json"),strict=load("paper/state.json");
if(!snapshot||!signals||!strict)throw Error("Missing input state");
const r=processAdaptiveShadow(load(dir+"/state.json",newAdaptiveState()),
  strict.openPositions||[],signals,snapshot);
write(dir+"/state.json",r.state);
append(dir+"/trades.jsonl",r.closedTrades);
append(dir+"/skipped.jsonl",r.skipped);
append(dir+"/events.jsonl",r.events);
const trades=lines(dir+"/trades.jsonl"),skipped=lines(dir+"/skipped.jsonl");
const baseline=new Map(lines("paper/trades.jsonl").map(x=>[x.id,x]));
const matched=trades.map(t=>({t,b:baseline.get(t.strictPositionId)}))
 .filter(x=>x.b&&x.b.plannedRiskEur>0);
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const stats=a=>{
  const positives=a.filter(x=>x.netPnlEur>0),negatives=a.filter(x=>x.netPnlEur<=0);
  const gain=positives.reduce((s,x)=>s+x.netPnlEur,0);
  const loss=negatives.reduce((s,x)=>s+x.netPnlEur,0);
  return {trades:a.length,wins:positives.length,losses:negatives.length,
    winRatePct:a.length?100*positives.length/a.length:null,
    netPnlEur:gain+loss,profitFactor:loss<0?gain/-loss:null,
    meanNetR:mean(a.map(x=>x.netR))};
};
const reasons={};
for(const s of skipped)reasons[s.reason]=(reasons[s.reason]||0)+1;
const skippedWithBaseline=skipped.map(s=>baseline.get(s.strictPositionId)).filter(Boolean);
write(dir+"/open-markets.json",{updatedAt:snapshot.collectedAt,
  markets:r.state.openPositions.map(x=>x.market)});
write(dir+"/latest.json",{
  version:"1.0",model:ADAPTIVE_POLICY.id,mode:"shadow",
  affectsLiveTrading:false,affectsFrozenProtocol:false,policy:ADAPTIVE_POLICY,
  startedAtSnapshot:r.state.startedAtSnapshot,updatedAtSnapshot:snapshot.collectedAt,
  status:trades.filter(x=>!x.dataGapped).length>=ADAPTIVE_POLICY.minimumCleanClosedTrades?
    "SAMPLE_CHECKPOINT_REACHED":"COLLECTING",
  methodology:[
    "Prospective only, new strict paper entries; no historical backfill.",
    "Execution assumptions: taker/taker fees, spread, entry buffer and adverse stop slippage.",
    "Target is a reference, NOT a take-profit order; 100% of the position can run.",
    "Trailing uses completed 5m bars, max confirmed close, ATR and trend, after 2 structural R. No unconditional break-even stop.",
    "Any trailing stop update starts on NEXT candle; gap-affected trades are marked and excluded from clean sample.",
    "No direct exchange, worker, trade or authenticated API access; experimental only."
  ],
  portfolio:{openPositions:r.state.openPositions.length,
    realizedEquityEur:r.state.realizedEquityEur,realizedNetPnlEur:r.state.realizedNetPnlEur,
    maxRealizedDrawdownPct:r.state.maxRealizedDrawdownPct},
  allTrades:stats(trades),cleanTrades:stats(trades.filter(x=>!x.dataGapped)),
  pairedBaseline:{n:matched.length,
    meanDeltaR:mean(matched.map(x=>x.t.netR-x.b.netPnlEur/x.b.plannedRiskEur)),
    better:matched.filter(x=>x.t.netR>x.b.netPnlEur/x.b.plannedRiskEur).length,
    worse:matched.filter(x=>x.t.netR<x.b.netPnlEur/x.b.plannedRiskEur).length},
  rejectedStrictEntries:{count:skipped.length,byReason:reasons,
    baselineClosed:skippedWithBaseline.length,
    baselineNetPnlEur:skippedWithBaseline.reduce((s,x)=>s+x.netPnlEur,0)},
  stats:r.state.stats,openedThisRun:r.opened,closedThisRun:r.closedTrades,
  skippedThisRun:r.skipped,
  openPositions:r.state.openPositions.map(x=>({market:x.market,entry:x.entry,
    currentStop:x.currentStop,originalTarget:x.originalTarget,
    checkpointReached:x.targetCheckpointReached,highestConfirmedClose:x.maxConfirmedClose,
    trailingActivated:x.trailingActivated,stopTightenings:x.stopTightenings,
    dataGapped:x.dataGapped}))
});
console.log(JSON.stringify({adaptive:"ok",snapshot:snapshot.collectedAt,
  opened:r.opened.length,closed:r.closedTrades.length,skipped:r.skipped.length,
  openPositions:r.state.openPositions.length}));
