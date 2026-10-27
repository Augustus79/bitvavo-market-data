import { closed5mBars } from "./paper-trader.js";

export const ADAPTIVE_POLICY = Object.freeze({
  id:"adaptive-runner-v1", startingCapitalEur:300, maxPositions:2, maxRiskEur:3,
  maxPositionEur:100, minStopPct:0.5, minStopAtr15:0.5, maxSpreadPct:0.25,
  minVolumeEur:250000, minBookBidsEur:500, minNetRR:1.5,
  entryFeePct:0.25, exitFeePct:0.25, entrySlippagePct:0.03, stopSlippagePct:0.4,
  activateTrailAtR:2, minTrailR:1.5, minCloseBufferAtr:1.5,
  minimumCleanClosedTrades:30
});
const num = x => x === null || x === undefined || x === "" ? null :
  (Number.isFinite(Number(x)) ? Number(x) : null);
const sum = (rows, callback) => rows.reduce((s,x)=>s+callback(x),0);
export function newAdaptiveState() {
  return { version:"1.0", model:ADAPTIVE_POLICY.id, mode:"shadow",
    startedAtSnapshot:null, lastProcessedSnapshot:null, seenStrictPositionIds:[],
    startingCapitalEur:300, realizedEquityEur:300, realizedNetPnlEur:0,
    peakRealizedEquityEur:300, maxRealizedDrawdownPct:0, openPositions:[],
    stats:{opened:0, closed:0, wins:0, losses:0, rejected:0,
      stopTightenings:0, targetCheckpoints:0, monitoringGaps:0, gappedClosed:0} };
}
function barsFor(snapshot, market) {
  const raw = snapshot.deep?.[market]?.candles?.["5m"];
  return Array.isArray(raw) ? closed5mBars(raw, Date.parse(snapshot.collectedAt)) : null;
}
function atr5(bars, i) {
  if (i < 14) return null;
  let tr = 0;
  for (let j=i-13; j<=i; j++) {
    const b=bars[j], pc=bars[j-1].close;
    tr += Math.max(b.high-b.low, Math.abs(b.high-pc), Math.abs(b.low-pc));
  }
  return tr/14;
}
function ema20(bars, i) {
  if (i<19) return null;
  let ema=bars[i-19].close;
  for (let j=i-18;j<=i;j++) ema=(2/21)*bars[j].close+(19/21)*ema;
  return ema;
}
export function qualifyEntry(signal, snapshot, state) {
  const p=ADAPTIVE_POLICY, data=snapshot.deep?.[signal?.market], ticker=data?.ticker;
  const entry=num(ticker?.ask), stop=num(signal?.stop), target=num(signal?.target);
  const spread=num(ticker?.spreadPct), volume=num(ticker?.volumeQuote);
  const bids=num(signal?.metrics?.book?.bidDepth10), atrPct=num(signal?.metrics?.["15m"]?.atrPct);
  const q=Object.values(signal?.dataQuality||{});
  if(signal?.action!=="BUY" || q.length!==3 || !q.every(x=>x?.ok===true) ||
     !(entry>0 && stop>0 && entry>stop && target>entry))
    return {reason:"INVALID_STRICT_SIGNAL_OR_DATA"};
  if(!(spread>=0 && spread<=p.maxSpreadPct && volume>=p.minVolumeEur && bids>=p.minBookBidsEur))
    return {reason:"LIQUIDITY_OR_SPREAD"};
  if(!(atrPct>0)) return {reason:"ATR15_UNAVAILABLE"};
  const costPct=p.entryFeePct+p.exitFeePct+spread+p.entrySlippagePct;
  const stopPct=100*(entry-stop)/entry;
  const minRequiredStopPct=Math.max(p.minStopPct,p.minStopAtr15*atrPct,0.8*costPct);
  if(stopPct<minRequiredStopPct)
    return {reason:"STOP_TOO_NARROW",stopPct,minRequiredStopPct};
  const riskPct=stopPct+costPct+p.stopSlippagePct;
  const netRR=(100*(target-entry)/entry-costPct)/riskPct;
  if(!(netRR>=p.minNetRR)) return {reason:"RISK_REWARD_AFTER_COSTS",netRR};
  if(state.openPositions.some(x=>x.market===signal.market))return {reason:"MARKET_ALREADY_OPEN"};
  if(state.openPositions.length>=p.maxPositions)return {reason:"CAPACITY"};
  const used=sum(state.openPositions,x=>x.amountEur);
  const existingRisk=sum(state.openPositions,x=>Math.max(0,x.amountEur*
    (100*(x.entry-x.currentStop)/x.entry+x.costPct+p.stopSlippagePct)/100));
  const allowance=Math.min(signal.tradeGrade==="B"?0.8:1.25,p.maxRiskEur-existingRisk);
  const amount=Math.min(p.maxPositionEur,Math.max(0,state.realizedEquityEur-used),allowance/(riskPct/100));
  if(!(allowance>0 && amount>=10))return {reason:"INSUFFICIENT_RISK_OR_CAPITAL"};
  const bars=barsFor(snapshot,signal.market);
  if(!bars?.length)return {reason:"MISSING_BARS"};
  return {entry,stop,target,costPct,stopPct,netRR,amount,
    initialRiskEur:amount*riskPct/100,lastBarTs:bars.at(-1).ts};
}
function closeAtStop(state,pos,b,at) {
  const p=ADAPTIVE_POLICY;
  // Conservative gap/open and adverse stop-fill modeling; no assumption of
  // executable fill at the theoretical stop price.
  const price=Math.min(b.open,pos.currentStop)*(1-p.stopSlippagePct/100);
  const gross=100*(price-pos.entry)/pos.entry;
  const netPnlEur=pos.amountEur*(gross-pos.costPct)/100;
  state.realizedNetPnlEur+=netPnlEur;
  state.realizedEquityEur=state.startingCapitalEur+state.realizedNetPnlEur;
  state.peakRealizedEquityEur=Math.max(state.peakRealizedEquityEur,state.realizedEquityEur);
  state.maxRealizedDrawdownPct=Math.max(state.maxRealizedDrawdownPct,
    100*(state.peakRealizedEquityEur-state.realizedEquityEur)/state.peakRealizedEquityEur);
  state.stats.closed++;
  if(netPnlEur>0)state.stats.wins++;else state.stats.losses++;
  if(pos.dataGapped)state.stats.gappedClosed++;
  return {strictPositionId:pos.strictPositionId,market:pos.market,family:pos.family,
    btcRegimeAtEntry:pos.btcRegimeAtEntry,openedAt:pos.openedAt,closedAt:at,
    entry:pos.entry,initialStop:pos.initialStop,stopAtExit:pos.currentStop,
    originalTarget:pos.originalTarget,targetCheckpointReached:pos.targetCheckpointReached,
    amountEur:pos.amountEur,plannedRiskEur:pos.initialRiskEur,
    exitPrice:price,exitReason:pos.trailingActivated?"ADAPTIVE_TRAIL_STOP":"INITIAL_STOP",
    netPnlEur,netR:netPnlEur/pos.initialRiskEur,
    maxConfirmedClose:pos.maxConfirmedClose,stopTightenings:pos.stopTightenings,
    dataGapped:pos.dataGapped,estimatedCostPct:pos.costPct,assumedStopSlippagePct:p.stopSlippagePct};
}
function managePosition(state,pos,snapshot) {
  const bars=barsFor(snapshot,pos.market),events=[];
  if(!bars) {
    state.stats.monitoringGaps++;
    events.push({type:"MISSING_MARKET_DATA",market:pos.market,at:snapshot.collectedAt});
    return {position:pos,events};
  }
  for(let i=0;i<bars.length;i++) {
    const b=bars[i];
    if(b.ts<=pos.lastBarTs)continue;
    if(b.ts-pos.lastBarTs>300000) {
      pos.dataGapped=true;
      state.stats.monitoringGaps++;
      events.push({type:"CANDLE_GAP",market:pos.market,at:b.ts});
    }
    // IMPORTANT: evaluate the stop carried into this candle BEFORE changing it.
    if(b.low<=pos.currentStop) {
      return {closedTrade:closeAtStop(state,pos,b,new Date(b.ts+300000).toISOString()),events};
    }
    pos.lastBarTs=b.ts;
    pos.maxConfirmedClose=Math.max(pos.maxConfirmedClose,b.close);
    if(!pos.targetCheckpointReached && b.close>=pos.originalTarget) {
      pos.targetCheckpointReached=true;
      state.stats.targetCheckpoints++;
      events.push({type:"TARGET_CHECKPOINT_NO_SALE",market:pos.market,at:new Date(b.ts+300000).toISOString()});
    }
    // 100% runner, never a target-limited sale and never unconditional breakeven.
    const atr=atr5(bars,i), structuralR=pos.entry-pos.initialStop;
    const gainR=(pos.maxConfirmedClose-pos.entry)/structuralR;
    if(!(atr>0 && gainR>=ADAPTIVE_POLICY.activateTrailAtR))continue;
    pos.trailingActivated=true;
    const trending=ema20(bars,i)!==null && b.close>=ema20(bars,i);
    const factor=(gainR>=5?2.5:gainR>=3?3:3.5)+(trending?0.5:-0.25);
    const width=Math.max(factor*atr,ADAPTIVE_POLICY.minTrailR*structuralR);
    const candidate=Math.min(pos.maxConfirmedClose-width,
      b.close-ADAPTIVE_POLICY.minCloseBufferAtr*atr);
    if(candidate>pos.currentStop+1e-12 && candidate>0) {
      const from=pos.currentStop;
      pos.currentStop=candidate;
      pos.stopTightenings++;
      state.stats.stopTightenings++;
      events.push({type:"STOP_TIGHTENED_EFFECTIVE_NEXT_BAR",market:pos.market,
        at:new Date(b.ts+300000).toISOString(),from,to:candidate,gainR});
    }
  }
  return {position:pos,events};
}
export function processAdaptiveShadow(input,strictPositions,signals,snapshot) {
  if(!snapshot?.collectedAt||signals?.snapshotCollectedAt!==snapshot.collectedAt||
     !Array.isArray(strictPositions))throw Error("Mismatched snapshot, signals or strict positions");
  const initial=!input?.startedAtSnapshot,base=newAdaptiveState();
  const state={...base,...(input||{}),stats:{...base.stats,...(input?.stats||{})},
    seenStrictPositionIds:[...(input?.seenStrictPositionIds||[])],
    openPositions:[...(input?.openPositions||[])]};
  if(initial)state.startedAtSnapshot=snapshot.collectedAt;
  if(state.lastProcessedSnapshot===snapshot.collectedAt)
    return {state,opened:[],closedTrades:[],skipped:[],events:[]};
  if(state.lastProcessedSnapshot &&
     Date.parse(snapshot.collectedAt)<Date.parse(state.lastProcessedSnapshot))
    throw Error("Out-of-order snapshot");
  const opened=[],closedTrades=[],skipped=[],events=[],survivors=[];
  for(const pos of state.openPositions){
    const r=managePosition(state,pos,snapshot);
    events.push(...r.events);
    if(r.closedTrade)closedTrades.push(r.closedTrade);
    else survivors.push(r.position);
  }
  state.openPositions=survivors;
  const seen=new Set(state.seenStrictPositionIds);
  const byMarket=new Map((signals.signals||[]).map(s=>[s.market,s]));
  for(const strict of strictPositions){
    if(!strict?.id||seen.has(strict.id))continue;
    seen.add(strict.id);
    // First snapshot intentionally does NOT backfill existing paper positions.
    if(initial||strict.openedAt!==snapshot.collectedAt)continue;
    const s=byMarket.get(strict.market),q=qualifyEntry(s,snapshot,state);
    if(q.reason){
      skipped.push({at:snapshot.collectedAt,market:strict.market,
        strictPositionId:strict.id,reason:q.reason,details:q});
      state.stats.rejected++;
      continue;
    }
    const pos={strictPositionId:strict.id,market:strict.market,family:strict.family,
      btcRegimeAtEntry:strict.btcRegimeAtEntry,openedAt:snapshot.collectedAt,
      entry:q.entry,initialStop:q.stop,currentStop:q.stop,originalTarget:q.target,
      targetCheckpointReached:false,costPct:q.costPct,amountEur:q.amount,
      initialRiskEur:q.initialRiskEur,initialStopPct:q.stopPct,entryStressNetRR:q.netRR,
      lastBarTs:q.lastBarTs,maxConfirmedClose:q.entry,trailingActivated:false,
      stopTightenings:0,dataGapped:false};
    state.openPositions.push(pos);
    state.stats.opened++;
    opened.push({market:pos.market,strictPositionId:pos.strictPositionId,
      amountEur:pos.amountEur,entryStressNetRR:pos.entryStressNetRR});
  }
  state.seenStrictPositionIds=[...seen].slice(-2000);
  state.lastProcessedSnapshot=snapshot.collectedAt;
  return {state,opened,closedTrades,skipped,events};
}
