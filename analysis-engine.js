// Analysis engine v0.1 for Bitvavo snapshot v2.2.
// Pure functions: no API keys, no trading, no order execution.

const CFG = {
  maxSnapshotAgeMin: 35,
  feePctPerSide: 0.25, // conservative placeholder; replace with actual account tier when known
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
  const reasons=[]; let score=0;
  if(h1?.trend===1){score+=2;reasons.push("1h uptrend");}
  if(m15?.trend===1){score+=1.5;reasons.push("15m uptrend");}
  if(m5?.trend===1){score+=0.5;reasons.push("5m aligned");}
  if(m15?.breakout || m5?.breakout){score+=1.5;reasons.push("recent breakout");}
  if((m15?.volumeRatio||0)>=1.3 || (m5?.volumeRatio||0)>=1.5){score+=1;reasons.push("volume acceleration");}
  const btc24=n(btc.ticker.change24hPct), rel24=n(x.ticker.change24hPct)-btc24;
  if(market!=="BTC-EUR" && rel24>=2){score+=1;reasons.push("relative strength vs BTC");}
  if(x.ticker.spreadPct<=0.10){score+=0.75;reasons.push("tight spread");}
  else if(x.ticker.spreadPct>0.30){score-=1;reasons.push("wide spread");}
  if(book.imbalance>0.10){score+=0.5;reasons.push("supportive top-book imbalance");}
  if(regime==="risk-on") score+=0.5;
  if(regime==="risk-off" && market!=="BTC-EUR") {score-=1;reasons.push("BTC risk-off penalty");}
  if((m5?.atrPct||0)>4){score-=0.75;reasons.push("very high 5m volatility");}
  const complete=["5m","15m","1h"].every(tf=>(x.candles[tf]||[]).length>=110);
  if(!complete){score-=0.5;reasons.push("incomplete intraday history");}
  score=clamp(score,0,10);

  let family="trend pullback";
  if(m15?.breakout||m5?.breakout) family="confirmed breakout";
  else if(rel24>=3 && m15?.trend===1) family="momentum/relative strength";
  else if(h1?.trend<=0 && m5?.trend===1) family="mean reversion";

  const entry=n(x.ticker.ask);
  const A=m15?.atr || m5?.atr;
  const structural=m15?.low20;
  let stop=(A&&structural)?Math.max(structural,entry-1.5*A):(A?entry-1.5*A:null);
  if(stop && stop>=entry) stop=entry-1.5*A;
  const riskPct=stop?100*(entry-stop)/entry:null;
  const grossTarget=stop?entry+2*(entry-stop):null;
  const roundTripCostPct=2*CFG.feePctPerSide + n(x.ticker.spreadPct||0);
  const netRewardPct=grossTarget?100*(grossTarget-entry)/entry-roundTripCostPct:null;
  const netRiskPct=riskPct!==null?riskPct+roundTripCostPct:null;
  const netRR=netRiskPct>0?netRewardPct/netRiskPct:null;

  let grade=score>=CFG.scoreA?"A":score>=CFG.scoreB?"B":null;
  let action=grade&&netRR>=CFG.minNetRR?"BUY":"WAIT";
  if(action==="WAIT" && grade && !(netRR>=CFG.minNetRR)) reasons.push("net R/R below threshold");

  const riskBudget=grade==="A"?mean(CFG.riskA):grade==="B"?mean(CFG.riskB):null;
  const amount=(action==="BUY"&&riskBudget&&netRiskPct>0)?riskBudget/(netRiskPct/100):null;
  return {market,action,grade,score:Number(score.toFixed(2)),family,btcRegime:regime,entry,stop,
    target2R:grossTarget,netRR:netRR===null?null:Number(netRR.toFixed(2)),riskPct,roundTripCostPct,
    suggestedRiskEur:riskBudget,suggestedAmountEur:amount?Number(amount.toFixed(2)):null,
    metrics:{"5m":m5,"15m":m15,"1h":h1,relative24hVsBTC:rel24,book},reasons};
}
function analyze(snapshot){
  if(snapshot.version!=="2.2") throw new Error("Expected snapshot v2.2");
  const btc=snapshot.deep["BTC-EUR"]; if(!btc) throw new Error("BTC-EUR missing");
  const regime=btcRegime(btc);
  const signals=Object.entries(snapshot.deep).map(([m,x])=>evaluate(m,x,btc,regime)).sort((a,b)=>b.score-a.score);
  return {engineVersion:"0.1",snapshotVersion:snapshot.version,snapshotCollectedAt:snapshot.collectedAt,analyzedAt:new Date().toISOString(),
    btcRegime:regime,config:CFG,actionable:signals.filter(x=>x.action!=="WAIT"),signals};
}

export { analyze };
