// dual-cohort paper state generation entrypoint
import fs from "node:fs";
import {
  STRICT_POLICY,
  OPPORTUNISTIC_POLICY,
  newState,
  processPaperState
} from "./paper-trader.js";

const snapshot = JSON.parse(fs.readFileSync("snapshot.json","utf8"));
const signals = JSON.parse(fs.readFileSync("signals.json","utf8"));
if (signals.snapshotCollectedAt !== snapshot.collectedAt) {
  throw new Error("signals.json does not match snapshot.json; refusing paper update");
}

fs.mkdirSync("paper",{recursive:true});

function readState(path, policy) {
  const base = newState(policy);
  if (!fs.existsSync(path)) return base;
  const raw = JSON.parse(fs.readFileSync(path,"utf8"));
  return {
    ...base,
    ...raw,
    version: base.version,
    model: base.model,
    policyId: policy.id,
    openPositions: raw.openPositions || [],
    pendingEntries: raw.pendingEntries || [],
    lastDirectCandidateByMarket: raw.lastDirectCandidateByMarket ||
      Object.fromEntries(Object.entries(raw.lastActionByMarket || {}).map(([m,a]) => [m, a === "BUY"])),
    lastRetestCandidateByMarket: raw.lastRetestCandidateByMarket || {},
    stats: { ...base.stats, ...(raw.stats || {}) }
  };
}

function appendJsonl(path, rows) {
  if (!rows.length) return;
  fs.appendFileSync(path, rows.map((x)=>JSON.stringify(x)).join("\n")+"\n");
}

function readJsonl(path) {
  if (!fs.existsSync(path)) return [];
  return fs.readFileSync(path,"utf8").split("\n").filter(Boolean).map((line)=>{
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function readAiCostSummary() {
  const path = "ai/cost-summary.json";
  if (!fs.existsSync(path)) {
    return {
      mode: "shadow",
      blocksTrades: false,
      auditsAttempted: 0,
      successfulAudits: 0,
      totalWebSearchCalls: 0,
      estimatedTotalCostUsd: 0,
      estimatedTotalCostEur: 0,
      monthly: {}
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(path,"utf8"));
    return {
      mode: "shadow",
      blocksTrades: false,
      auditsAttempted: Number(raw.auditsAttempted) || 0,
      successfulAudits: Number(raw.successfulAudits) || 0,
      failedAudits: Number(raw.failedAudits) || 0,
      totalWebSearchCalls: Number(raw.totalWebSearchCalls) || 0,
      totalInputTokens: Number(raw.totalInputTokens) || 0,
      totalOutputTokens: Number(raw.totalOutputTokens) || 0,
      estimatedTotalCostUsd: Number(raw.estimatedTotalCostUsd) || 0,
      estimatedTotalCostEur: Number(raw.estimatedTotalCostEur) || 0,
      referenceUsdToEur: Number(raw.referenceUsdToEur) || null,
      monthly: raw.monthly || {},
      verdictCounts: raw.verdictCounts || {}
    };
  } catch {
    return {
      mode: "shadow",
      blocksTrades: false,
      auditsAttempted: 0,
      successfulAudits: 0,
      totalWebSearchCalls: 0,
      estimatedTotalCostUsd: 0,
      estimatedTotalCostEur: 0,
      monthly: {},
      parseError: true
    };
  }
}

function summarize(state, trades) {
  const wins = trades.filter((t)=>t.netPnlEur>0);
  const losses = trades.filter((t)=>t.netPnlEur<=0);
  const grossProfit = wins.reduce((s,t)=>s+t.netPnlEur,0);
  const grossLoss = Math.abs(losses.reduce((s,t)=>s+t.netPnlEur,0));
  const excursionTrades = trades.filter((t)=>
    Number.isFinite(Number(t.mfePctGross)) && Number.isFinite(Number(t.maePctGross))
  );
  const avg = (rows, key) => rows.length
    ? rows.reduce((s,t)=>s+Number(t[key]),0)/rows.length
    : null;
  return {
    closedTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length ? 100*wins.length/trades.length : null,
    realizedNetPnlEur: state.realizedNetPnlEur,
    realizedEquityEur: state.realizedEquityEur,
    expectancyEurPerTrade: trades.length ? state.realizedNetPnlEur/trades.length : null,
    profitFactor: grossLoss>0 ? grossProfit/grossLoss : null,
    excursionSampleSize: excursionTrades.length,
    avgMfePctGross: avg(excursionTrades,"mfePctGross"),
    avgMaePctGross: avg(excursionTrades,"maePctGross"),
    avgMfeStructuralR: avg(excursionTrades.filter((t)=>Number.isFinite(Number(t.mfeStructuralR))),"mfeStructuralR"),
    avgMaeStructuralR: avg(excursionTrades.filter((t)=>Number.isFinite(Number(t.maeStructuralR))),"maeStructuralR"),
    maxRealizedDrawdownEur: state.maxRealizedDrawdownEur,
    maxRealizedDrawdownPct: state.maxRealizedDrawdownPct,
    openPositions: state.openPositions.length,
    pendingEntries: state.pendingEntries.length
  };
}

const strictStatePath = "paper/state.json";
const oppStatePath = "paper/opportunistic-state.json";

const strictState = readState(strictStatePath, STRICT_POLICY);
const oppState = readState(oppStatePath, OPPORTUNISTIC_POLICY);

if (
  strictState.lastProcessedSnapshot === snapshot.collectedAt &&
  oppState.lastProcessedSnapshot === snapshot.collectedAt
) {
  console.log(JSON.stringify({skipped:true,reason:"snapshot already processed",snapshot:snapshot.collectedAt},null,2));
  process.exit(0);
}

const strictResult = strictState.lastProcessedSnapshot === snapshot.collectedAt
  ? { state: strictState, closedTrades: [], skippedSignals: [], events: [] }
  : processPaperState(strictState, signals, snapshot, STRICT_POLICY);

const oppResult = oppState.lastProcessedSnapshot === snapshot.collectedAt
  ? { state: oppState, closedTrades: [], skippedSignals: [], events: [] }
  : processPaperState(oppState, signals, snapshot, OPPORTUNISTIC_POLICY);

fs.writeFileSync(strictStatePath, JSON.stringify(strictResult.state,null,2)+"\n");
fs.writeFileSync(oppStatePath, JSON.stringify(oppResult.state,null,2)+"\n");

appendJsonl("paper/trades.jsonl", strictResult.closedTrades);
appendJsonl("paper/skipped.jsonl", strictResult.skippedSignals);
appendJsonl("paper/events.jsonl", strictResult.events);
appendJsonl("paper/opportunistic-trades.jsonl", oppResult.closedTrades);
appendJsonl("paper/opportunistic-skipped.jsonl", oppResult.skippedSignals);
appendJsonl("paper/opportunistic-events.jsonl", oppResult.events);

const forcedMarkets = [...new Set([
  ...strictResult.state.openPositions.map((p)=>p.market),
  ...strictResult.state.pendingEntries.map((p)=>p.market),
  ...oppResult.state.openPositions.map((p)=>p.market),
  ...oppResult.state.pendingEntries.map((p)=>p.market)
])];

fs.writeFileSync("paper/open-markets.json", JSON.stringify({
  updatedAt: snapshot.collectedAt,
  markets: forcedMarkets
},null,2)+"\n");

const strictTrades = readJsonl("paper/trades.jsonl");
const oppTrades = readJsonl("paper/opportunistic-trades.jsonl");
const aiShadowAudit = readAiCostSummary();
const aiCostEur = Number(aiShadowAudit.estimatedTotalCostEur) || 0;
const comparison = {
  version: "1.0",
  updatedAt: snapshot.collectedAt,
  note: "Strict mirrors production BUY logic. Opportunistic is paper-only: clean triggers can enter at net RR >= 1.25 or place a 30-minute retest limit targeting net RR 1.5. AI contextual review is shadow-only and never changes entries, exits, sizing or signal validity.",
  aiShadowAudit,
  strict: {
    policy: STRICT_POLICY,
    ...summarize(strictResult.state, strictTrades),
    aiShadowAuditCostEur: aiCostEur,
    realizedNetPnlAfterAiCostEur: strictResult.state.realizedNetPnlEur - aiCostEur,
    realizedEquityAfterAiCostEur: strictResult.state.realizedEquityEur - aiCostEur
  },
  opportunistic: {
    policy: OPPORTUNISTIC_POLICY,
    ...summarize(oppResult.state, oppTrades)
  }
};
fs.writeFileSync("paper/comparison.json", JSON.stringify(comparison,null,2)+"\n");

console.log(JSON.stringify({
  snapshot: snapshot.collectedAt,
  strict: {
    openPositions: strictResult.state.openPositions.map((p)=>p.market),
    closedNow: strictResult.closedTrades.length,
    realizedEquityEur: Number(strictResult.state.realizedEquityEur.toFixed(4)),
    stats: strictResult.state.stats
  },
  opportunistic: {
    openPositions: oppResult.state.openPositions.map((p)=>p.market),
    pendingEntries: oppResult.state.pendingEntries.map((p)=>p.market),
    closedNow: oppResult.closedTrades.length,
    realizedEquityEur: Number(oppResult.state.realizedEquityEur.toFixed(4)),
    stats: oppResult.state.stats
  },
  forcedMarkets
},null,2));
