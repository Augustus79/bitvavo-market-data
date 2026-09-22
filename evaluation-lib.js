export function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export function mean(values) {
  const xs = values.map(Number).filter(Number.isFinite);
  return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
}

export function percentile(values, p) {
  const xs = values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0];
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return xs[lo];
  const w = pos - lo;
  return xs[lo] * (1-w) + xs[hi] * w;
}

function tCritical95(n) {
  if (n < 2) return null;
  const df = n - 1;
  if (df <= 1) return 12.706;
  if (df <= 2) return 4.303;
  if (df <= 4) return 2.776;
  if (df <= 9) return 2.262;
  if (df <= 19) return 2.093;
  if (df <= 29) return 2.045;
  if (df <= 49) return 2.010;
  if (df <= 99) return 1.984;
  return 1.960;
}

export function meanCi95(values) {
  const xs = values.map(Number).filter(Number.isFinite);
  const m = mean(xs);
  if (xs.length < 2) return { n: xs.length, mean: m, low: null, high: null };
  const variance = xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1);
  const se = Math.sqrt(variance/xs.length);
  const t = tCritical95(xs.length);
  return { n: xs.length, mean:m, low:m-t*se, high:m+t*se };
}

export function tradeStats(trades) {
  const usable = trades.filter(t => Number.isFinite(Number(t?.netPnlEur)) && Number(t?.plannedRiskEur) > 0);
  const rs = usable.map(t => Number(t.netPnlEur)/Number(t.plannedRiskEur));
  const wins = usable.filter(t => Number(t.netPnlEur) > 0);
  const losses = usable.filter(t => Number(t.netPnlEur) <= 0);
  const grossProfit = wins.reduce((s,t)=>s+Number(t.netPnlEur),0);
  const grossLoss = Math.abs(losses.reduce((s,t)=>s+Number(t.netPnlEur),0));
  return {
    trades: usable.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: usable.length ? 100*wins.length/usable.length : null,
    netPnlEur: usable.reduce((s,t)=>s+Number(t.netPnlEur),0),
    meanNetR: mean(rs),
    meanNetRApprox95CI: meanCi95(rs),
    profitFactor: grossLoss > 0 ? grossProfit/grossLoss : null
  };
}

export function decisionFromStats(stats, protocolOk, protocol) {
  if (!protocolOk) return "PROTOCOL_CHANGED";
  const nTrades = Number(stats?.trades) || 0;
  const ci = stats?.meanNetRApprox95CI || {};
  const first = Number(protocol?.primaryHypothesis?.firstDecisionCheckpointTrades) || 50;
  const support = Number(protocol?.primaryHypothesis?.supportCheckpointTrades) || 100;
  if (nTrades < first) return "INSUFFICIENT_DATA";
  if (Number.isFinite(ci.high) && ci.high <= 0) return "FALSIFIED";
  if (nTrades >= support && Number.isFinite(ci.low) && ci.low > 0) return "SUPPORTED";
  return "INCONCLUSIVE";
}

export function groupedStats(trades, selector) {
  const groups = new Map();
  for (const t of trades) {
    const key = String(selector(t) ?? "unknown");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return Object.fromEntries([...groups.entries()].map(([k,v])=>[k,tradeStats(v)]));
}

export function stabilitySummary(rows, criteria) {
  const valid = rows
    .filter(r => Number.isFinite(Date.parse(r?.snapshotCollectedAt)))
    .sort((a,b)=>Date.parse(a.snapshotCollectedAt)-Date.parse(b.snapshotCollectedAt));
  if (!valid.length) return {
    status:"COLLECTING", runs:0, observationWindowHours:0, coveragePct:null,
    gapCount:null, maxGapSec:null, p50PipelineLatencySec:null, p95PipelineLatencySec:null, staleRuns:0
  };

  const firstMs=Date.parse(valid[0].snapshotCollectedAt);
  const lastMs=Date.parse(valid.at(-1).snapshotCollectedAt);
  const spanHours=Math.max(0,(lastMs-firstMs)/3600000);
  const interval=Number(criteria.snapshotIntervalSec)||300;
  const expected=Math.max(1,Math.round((lastMs-firstMs)/(interval*1000))+1);
  const unique=new Set(valid.map(r=>r.snapshotCollectedAt)).size;
  let gapCount=0,maxGapSec=0;
  for(let i=1;i<valid.length;i++){
    const gap=(Date.parse(valid[i].snapshotCollectedAt)-Date.parse(valid[i-1].snapshotCollectedAt))/1000;
    if(gap>interval*1.5) gapCount++;
    maxGapSec=Math.max(maxGapSec,gap);
  }
  const latencies=valid.map(r=>Number(r.pipelineLatencySec)).filter(Number.isFinite);
  const staleRuns=valid.filter(r=>r.snapshotFresh===false).length;
  const coveragePct=100*unique/expected;
  const p50=percentile(latencies,0.5);
  const p95=percentile(latencies,0.95);
  const minWindow=Number(criteria.minimumObservationWindowHours)||6;
  let status="COLLECTING";
  if(spanHours>=minWindow){
    status = coveragePct >= Number(criteria.minimumCoveragePct||95) &&
      (p95 === null || p95 <= Number(criteria.maximumP95PipelineLatencySec||120)) &&
      staleRuns <= Number(criteria.maximumStaleRuns||0)
      ? "HEALTHY" : "DEGRADED";
  }
  return {
    status,
    runs:valid.length,
    observationWindowHours:spanHours,
    coveragePct,
    gapCount,
    maxGapSec,
    p50PipelineLatencySec:p50,
    p95PipelineLatencySec:p95,
    staleRuns
  };
}
