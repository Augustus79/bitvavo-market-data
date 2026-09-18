// Analysis engine v0.3 for Bitvavo snapshot v2.2.
// Pure functions: no API keys, no trading, no order execution.

const CFG = {
  maxSnapshotAgeMin: 35,
  makerFeePct: 0.15, // Bitvavo Category A tier 0 (EUR), current public fee schedule
  takerFeePct: 0.25,
  slippageBufferPct: 0.03,
  minNetRR: 1.5,
  scoreB: 7.0,
  scoreA: 8.0,
  riskB: [0.60, 1.00],
  riskA: [1.00, 1.50]
};

const n = (x) => Number(x);
const mean = (a) => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

function bars(raw){
  // Bitvavo returns newest first: [timestamp, open, high, low, close, volume]
  return [...raw].reverse().map(r=>({t:n(r[0]),o:n(r[1]),h:n(r[2]),l:n(r[3]),c:n(r[4]),v:n(r[5])}));
}
function ema(a,p){
  if(!a.length) return null; const k=2/(p+1); let e=a[0];
  for(let i=1;i<a.length;i++) e=a[i]*k+e*(1-k); return e;
}
function atr(b,p=14){
  if(b.length<p+1) return null; const tr=[];
  for(let i=1;i<b.length;i++) tr.push(Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));
  return mean(tr.slice(-p));
}
function tfMetrics(raw){
  const b=bars(raw), closes=b.map(x=>x.c), vols=b.map(x=>x.v), last=b.at(-1);
  if(!last) return null;
  const e20=ema(closes.slice(-60),20), e50=ema(closes,50), A=atr(b);
  const prev20=b.slice(-21,-1), hi20=prev20.length?Math.max(...prev20.map(x=>x.h)):null, lo20=prev20.length?Math.min(...prev20.map(x=>x.l)):null;
  const v20=mean(vols.slice(-21,-1));
  return {last:last.c,ema20:e20,ema50:e50,atr:A,atrPct:A?100*A/last.c:null,
    trend:e20&&e50?(last.c>e20&&e20>e50?1:last.c<e20&&e20<e50?-1:0):0,
    breakout:hi20?last.c>hi20:false, breakdown:lo20?last.c<lo20:false,
    volumeRatio:v20?last.v/v20:null, high20:hi20, low20:lo20};
}
function bookMetrics(book){
  const bids=(book?.bids||[]).map(x=>[n(x[0]),n(x[1])]), asks=(book?.asks||[]).map(x=>[n(x[0]),n(x[1])]);
  const bq=bids.slice(0,10).reduce((s,x)=>s+x[0]*x[1],0), aq=asks.slice(0,10).reduce((s,x)=>s+x[0]*x[1],0);
  return {imbalance:(bq+aq)?(bq-aq)/(bq+aq):0,bidDepth10:bq,askDepth10:aq,levels:{bids:bids.length,asks:asks.length}};
}
function btcRegime(btc){
  const h=tfMetrics(btc.candles["1h"]), m=tfMetrics(btc.candles["15m"]);
  if(h?.trend===1 && m?.trend>=0) return "risk-on";
  if(h?.trend===-1 && m?.trend<=0) return "risk-off";
  return "neutral";
}
function evaluate(market,x,btc,regime){
  const m5=tfMetrics(x.candles["5m"]), m15=tfMetrics(x.candles["15m"]), h1=tfMetrics(x.candles["1h"]), book=bookMetrics(x.orderBook);
  const btc24=n(btc.ticker.change24hPct), rel24=n(x.ticker.change24hPct)-btc24;
  const spread=n(x.ticker.spreadPct||0);
  const complete=["5m","15m","1h"].every(tf=>(x.candles[tf]||[]).length>=110);
  const candidates=[];

  const qualityAdjust=(base,reasons)=>{
    let s=base;
    if(spread<=0.10){s+=0.5;reasons.push("tight spread");}
    else if(spread>0.30){s-=1;reasons.push("wide spread");}
    if(book.imbalance>0.10){s+=0.25;reasons.push("supportive top-book imbalance");}
    if(regime==="risk-on") s+=0.5;
    if(regime==="risk-off" && market!=="BTC-EUR"){s-=1;reasons.push("BTC risk-off penalty");}
    if((m5?.atrPct||0)>4){s-=0.75;reasons.push("very high 5m volatility");}
    if(!complete){s-=0.5;reasons.push("incomplete intraday history");}
    return clamp(s,0,10);
  };

  { // Trend pullback: established 1h/15m trend, price near 15m EMA20, 5m holding/recovering.
    const reasons=[]; let s=0;
    if(h1?.trend===1){s+=2.5;reasons.push("1h uptrend");}
    if(m15?.trend===1){s+=2;reasons.push("15m uptrend");}
    const dist15=m15?.ema20?Math.abs(m15.last-m15.ema20)/m15.ema20*100:99;
    const tolerance=Math.max(0.35,(m15?.atrPct||0)*0.65);
    if(dist15<=tolerance){s+=2;reasons.push("15m pullback near EMA20");}
    if(m5?.trend>=0){s+=1;reasons.push("5m holding/recovering");}
    if((m5?.volumeRatio||0)>=0.8){s+=0.5;reasons.push("5m participation adequate");}
    candidates.push({family:"trend pullback",score:qualityAdjust(s,reasons),reasons});
  }

  { // Breakout: actual 5m/15m range break + volume confirmation; trend context matters.
    const reasons=[]; let s=0;
    if(h1?.trend===1){s+=1.5;reasons.push("1h trend supports breakout");}
    if(m15?.breakout){s+=3;reasons.push("15m breakout");}
    else if(m5?.breakout){s+=2;reasons.push("5m breakout");}
    if((m15?.volumeRatio||0)>=1.3){s+=2;reasons.push("15m volume confirmation");}
    else if((m5?.volumeRatio||0)>=1.5){s+=1.5;reasons.push("5m volume confirmation");}
    if(m15?.trend===1){s+=1;reasons.push("15m structure aligned");}
    candidates.push({family:"confirmed breakout",score:qualityAdjust(s,reasons),reasons});
  }

  { // Momentum/RS: persistent trend + outperformance, but avoid rewarding a 24h pump alone.
    const reasons=[]; let s=0;
    if(h1?.trend===1){s+=2;reasons.push("1h uptrend");}
    if(m15?.trend===1){s+=1.5;reasons.push("15m uptrend");}
    if(m5?.trend===1){s+=1;reasons.push("5m aligned");}
    if(rel24>=2){s+=1.5;reasons.push("relative strength vs BTC");}
    if(rel24>=5){s+=0.5;reasons.push("strong relative strength");}
    if((m15?.volumeRatio||0)>=1.0 || (m5?.volumeRatio||0)>=1.2){s+=1.5;reasons.push("active volume");}
    candidates.push({family:"momentum/relative strength",score:qualityAdjust(s,reasons),reasons});
  }

  { // Mean reversion: requires prior weakness/excess plus an actual 5m reversal; never score from 24h gain alone.
    const reasons=[]; let s=0;
    if(h1?.trend<=0){s+=1.5;reasons.push("not extended in 1h uptrend");}
    if(m15?.trend===-1){s+=1.5;reasons.push("15m prior weakness");}
    if(m5?.trend===1){s+=2.5;reasons.push("5m reversal");}
    if(m5?.ema20 && m5.last>m5.ema20){s+=1;reasons.push("reclaimed 5m EMA20");}
    if((m5?.volumeRatio||0)>=1.2){s+=1.5;reasons.push("reversal volume");}
    candidates.push({family:"mean reversion",score:qualityAdjust(s,reasons),reasons});
  }

  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0], family=best.family, reasons=[...best.reasons], score=best.score;

  const entry=n(x.ticker.ask);
  const A=m15?.atr || m5?.atr;
  const structural=m15?.low20;
  let stop=(A&&structural)?Math.max(structural,entry-1.5*A):(A?entry-1.5*A:null);
  if(stop && stop>=entry) stop=entry-1.5*A;
  const riskPct=stop?100*(entry-stop)/entry:null;
  const grossTarget=stop?entry+2*(entry-stop):null;
  const entryFeePct = family==="trend pullback" ? CFG.makerFeePct : CFG.takerFeePct;
  const exitFeePct = CFG.takerFeePct;
  const roundTripCostPct=entryFeePct + exitFeePct + spread + CFG.slippageBufferPct;
  const netRewardPct=grossTarget?100*(grossTarget-entry)/entry-roundTripCostPct:null;
  const netRiskPct=riskPct!==null?riskPct+roundTripCostPct:null;
  const netRR=netRiskPct>0?netRewardPct/netRiskPct:null;

  const grade=score>=CFG.scoreA?"A":score>=CFG.scoreB?"B":null;
  const action=grade&&netRR>=CFG.minNetRR?"BUY":"WAIT";
  if(action==="WAIT" && grade && !(netRR>=CFG.minNetRR)) reasons.push("net R/R below threshold");
  const riskBudget=grade==="A"?mean(CFG.riskA):grade==="B"?mean(CFG.riskB):null;
  const amount=(action==="BUY"&&riskBudget&&netRiskPct>0)?riskBudget/(netRiskPct/100):null;

  return {market,action,grade,score:Number(score.toFixed(2)),family,btcRegime:regime,entry,stop,
    target2R:grossTarget,netRR:netRR===null?null:Number(netRR.toFixed(2)),riskPct,roundTripCostPct,
    suggestedRiskEur:riskBudget,suggestedAmountEur:amount?Number(amount.toFixed(2)):null,
    candidateScores:Object.fromEntries(candidates.map(x=>[x.family,Number(x.score.toFixed(2))])),
    metrics:{"5m":m5,"15m":m15,"1h":h1,relative24hVsBTC:rel24,book},reasons};
}
function analyze(snapshot){
  if(snapshot.version!=="2.2") throw new Error("Expected snapshot v2.2");
  const btc=snapshot.deep["BTC-EUR"]; if(!btc) throw new Error("BTC-EUR missing");
  const regime=btcRegime(btc);
  const signals=Object.entries(snapshot.deep).map(([m,x])=>evaluate(m,x,btc,regime)).sort((a,b)=>b.score-a.score);
  return {engineVersion:"0.3",snapshotVersion:snapshot.version,snapshotCollectedAt:snapshot.collectedAt,analyzedAt:new Date().toISOString(),
    btcRegime:regime,config:CFG,actionable:signals.filter(x=>x.action!=="WAIT"),signals};
}

export { analyze };
