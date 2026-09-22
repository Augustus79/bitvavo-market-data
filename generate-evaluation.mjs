import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  tradeStats, decisionFromStats, groupedStats, stabilitySummary
} from "./evaluation-lib.js";

const protocol=JSON.parse(fs.readFileSync("experiment/protocol.json","utf8"));
const signals=JSON.parse(fs.readFileSync("signals.json","utf8"));
const comparison=JSON.parse(fs.readFileSync("paper/comparison.json","utf8"));

function readJsonl(file){
  if(!fs.existsSync(file)) return [];
  return fs.readFileSync(file,"utf8").split("\n").filter(Boolean).map(line=>{
    try{return JSON.parse(line);}catch{return null;}
  }).filter(Boolean);
}
function gitBlobSha(file){
  const buf=fs.readFileSync(file);
  return crypto.createHash("sha1")
    .update(Buffer.from(`blob ${buf.length}\0`))
    .update(buf)
    .digest("hex");
}
function ensureDir(dir){ fs.mkdirSync(dir,{recursive:true}); }
function appendUniqueJsonl(file,row,key){
  ensureDir(path.dirname(file));
  const rows=readJsonl(file);
  if(rows.some(x=>x?.[key]===row?.[key])) return false;
  fs.appendFileSync(file,JSON.stringify(row)+"\n");
  return true;
}

const actualLocks={
  analysisEngineGitBlobSha:gitBlobSha("analysis-engine.js"),
  paperTraderGitBlobSha:gitBlobSha("paper-trader.js")
};
const expectedLocks={
  analysisEngineGitBlobSha:protocol.frozenModel.analysisEngineGitBlobSha,
  paperTraderGitBlobSha:protocol.frozenModel.paperTraderGitBlobSha
};
const lockMatches=
  actualLocks.analysisEngineGitBlobSha===expectedLocks.analysisEngineGitBlobSha &&
  actualLocks.paperTraderGitBlobSha===expectedLocks.paperTraderGitBlobSha;

const strictTrades=readJsonl("paper/trades.jsonl");
const oppTrades=readJsonl("paper/opportunistic-trades.jsonl");
const aiReviews=readJsonl("ai/reviews.jsonl");
const strict=tradeStats(strictTrades);
const opportunistic=tradeStats(oppTrades);
const decision=decisionFromStats(strict,lockMatches,protocol);

const evaluatedAt=new Date().toISOString();
const snapshotMs=Date.parse(signals.snapshotCollectedAt);
const pipelineLatencySec=Number.isFinite(snapshotMs)
  ? Number(((Date.now()-snapshotMs)/1000).toFixed(2))
  : null;
const month=signals.snapshotCollectedAt.slice(0,7);
const runFile=`evaluation/runs-${month}.jsonl`;
const runRow={
  schemaVersion:"1.0",
  snapshotCollectedAt:signals.snapshotCollectedAt,
  evaluatedAt,
  pipelineLatencySec,
  snapshotFresh:Boolean(signals.snapshotFresh),
  signalCount:Array.isArray(signals.signals)?signals.signals.length:0,
  actionableCount:Array.isArray(signals.actionable)?signals.actionable.length:0,
  strictClosedTrades:strict.trades,
  opportunisticClosedTrades:opportunistic.trades,
  aiAuditsAttempted:Number(comparison?.aiShadowAudit?.auditsAttempted)||0,
  aiEstimatedTotalCostEur:Number(comparison?.aiShadowAudit?.estimatedTotalCostEur)||0,
  protocolLockMatches:lockMatches
};
appendUniqueJsonl(runFile,runRow,"snapshotCollectedAt");

const allRunFiles=fs.existsSync("evaluation")
  ? fs.readdirSync("evaluation").filter(x=>/^runs-\d{4}-\d{2}\.jsonl$/.test(x))
  : [];
const cutoff=Date.now()-24*3600000;
const recentRuns=allRunFiles.flatMap(f=>readJsonl(path.join("evaluation",f)))
  .filter(r=>Date.parse(r.snapshotCollectedAt)>=cutoff);
const stability=stabilitySummary(recentRuns,protocol.stabilityCriteria);

const reviewByKey=new Map(
  aiReviews.filter(r=>r?.status==="ok")
    .map(r=>[`${r.activationStartedAt}|${r.market}`,r])
);
const reviewedClosed=strictTrades.map(t=>{
  const signalAt=t.signalSnapshotAt??t.openedAt;
  const review=reviewByKey.get(`${signalAt}|${t.market}`)||null;
  return {trade:t,review};
}).filter(x=>x.review);

const aiByVerdict={};
for(const verdict of ["NO_MATERIAL_RISK_FOUND","MATERIAL_RISK_FOUND","INSUFFICIENT_INFORMATION"]){
  aiByVerdict[verdict]=tradeStats(
    reviewedClosed.filter(x=>x.review.verdict===verdict).map(x=>x.trade)
  );
}
const materialRiskTrades=reviewedClosed
  .filter(x=>x.review.verdict==="MATERIAL_RISK_FOUND")
  .map(x=>x.trade);
const materialRiskPnl=materialRiskTrades.reduce((s,t)=>s+Number(t.netPnlEur||0),0);
const aiCostEur=Number(comparison?.aiShadowAudit?.estimatedTotalCostEur)||0;
const actualStrictPnl=Number(comparison?.strict?.realizedNetPnlEur)||0;

const report={
  version:"1.0",
  protocolVersion:protocol.version,
  generatedAt:evaluatedAt,
  snapshotCollectedAt:signals.snapshotCollectedAt,
  protocolIntegrity:{
    status:lockMatches?"LOCKED":"CHANGED",
    expected:expectedLocks,
    actual:actualLocks
  },
  prospectiveDecision:{
    status:decision,
    closedStrictTrades:strict.trades,
    firstDecisionCheckpointTrades:protocol.primaryHypothesis.firstDecisionCheckpointTrades,
    supportCheckpointTrades:protocol.primaryHypothesis.supportCheckpointTrades,
    meanNetR:strict.meanNetR,
    meanNetRApprox95CI:strict.meanNetRApprox95CI
  },
  strict:{
    ...strict,
    realizedNetPnlAfterAiCostEur:actualStrictPnl-aiCostEur,
    aiShadowCostEur:aiCostEur,
    maxRealizedDrawdownPct:comparison?.strict?.maxRealizedDrawdownPct??null
  },
  opportunistic,
  breakdowns:{
    strictByFamily:groupedStats(strictTrades,t=>t.family),
    strictByGrade:groupedStats(strictTrades,t=>t.tradeGrade),
    strictByBtcRegime:groupedStats(strictTrades,t=>t.btcRegimeAtEntry)
  },
  aiShadow:{
    reviewedClosedTrades:reviewedClosed.length,
    minimumReviewedClosedTradesBeforeInterpretation:protocol.aiShadowHypothesis.minimumReviewedClosedTradesBeforeInterpretation,
    byVerdict:aiByVerdict,
    materialRiskReviewedClosedTrades:materialRiskTrades.length,
    materialRiskTradesActualPnlEur:materialRiskPnl,
    counterfactualPnlIfMaterialRiskVetoEur:actualStrictPnl-materialRiskPnl-aiCostEur,
    actualPnlAfterAiCostEur:actualStrictPnl-aiCostEur,
    note:"Counterfactual is descriptive paper analysis, not causal proof."
  },
  operationalStability:stability,
  riskReview:{
    thresholdPct:protocol.riskReviewThresholds.maxRealizedDrawdownPctForReview,
    currentMaxRealizedDrawdownPct:comparison?.strict?.maxRealizedDrawdownPct??null,
    reviewTriggered:Number(comparison?.strict?.maxRealizedDrawdownPct||0)>=Number(protocol.riskReviewThresholds.maxRealizedDrawdownPctForReview)
  }
};
ensureDir("evaluation");
fs.writeFileSync("evaluation/latest.json",JSON.stringify(report,null,2)+"\n");

console.log(JSON.stringify({
  protocolIntegrity:report.protocolIntegrity.status,
  prospectiveDecision:report.prospectiveDecision.status,
  strictClosedTrades:strict.trades,
  strictMeanNetR:strict.meanNetR,
  operationalStability:stability.status,
  pipelineLatencySec,
  aiReviewedClosedTrades:reviewedClosed.length
},null,2));
