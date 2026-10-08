import fs from "node:fs";
import {
  PORTFOLIO_SHADOW_MIN_CLOSED_TRADES,
  PORTFOLIO_SHADOW_POLICY,
  estimatedPositionRiskEur,
  newPortfolioShadowState,
  portfolioSnapshot,
  processPortfolioShadowState
} from "./portfolio-shadow-lib.js";

const DIR = "portfolio-shadow";
const STATE_PATH = `${DIR}/state.json`;
const TRADES_PATH = `${DIR}/trades.jsonl`;
const EVENTS_PATH = `${DIR}/events.jsonl`;
const SKIPPED_PATH = `${DIR}/skipped.jsonl`;
const LATEST_PATH = `${DIR}/latest.json`;
const OPEN_MARKETS_PATH = `${DIR}/open-markets.json`;

function readJson(path, fallback = null) {
  if (!fs.existsSync(path)) return fallback;
  try { return JSON.parse(fs.readFileSync(path, "utf8")); }
  catch { return fallback; }
}

function readJsonl(path) {
  if (!fs.existsSync(path)) return [];
  return fs.readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

function writeJson(path, value) {
  fs.writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function appendJsonl(path, rows) {
  if (!rows.length) return;
  fs.appendFileSync(path, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
}

function statsFromTrades(rows) {
  const wins = rows.filter((t) => Number(t.netPnlEur) > 0);
  const losses = rows.filter((t) => Number(t.netPnlEur) <= 0);
  const grossProfit = wins.reduce((s, t) => s + Number(t.netPnlEur || 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + Number(t.netPnlEur || 0), 0));
  const rs = rows.map((t) => Number(t.netR)).filter(Number.isFinite);
  const meanNetR = rs.length ? rs.reduce((a,b) => a+b, 0) / rs.length : null;
  return {
    trades: rows.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: rows.length ? 100 * wins.length / rows.length : null,
    netPnlEur: rows.reduce((s, t) => s + Number(t.netPnlEur || 0), 0),
    meanNetR,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    bestNetR: rs.length ? Math.max(...rs) : null,
    worstNetR: rs.length ? Math.min(...rs) : null
  };
}

fs.mkdirSync(DIR, { recursive: true });

const snapshot = readJson("snapshot.json");
const signals = readJson("signals.json");
if (!snapshot?.collectedAt || !signals?.snapshotCollectedAt) {
  throw new Error("snapshot.json or signals.json missing");
}
if (snapshot.collectedAt !== signals.snapshotCollectedAt) {
  throw new Error("signals.json does not match snapshot.json");
}

const existing = readJson(STATE_PATH, newPortfolioShadowState());
const result = processPortfolioShadowState(existing, signals, snapshot);

writeJson(STATE_PATH, result.state);
appendJsonl(TRADES_PATH, result.closedTrades);
appendJsonl(EVENTS_PATH, result.events);
appendJsonl(SKIPPED_PATH, result.skippedEntries);

const openMarkets = [...new Set(result.state.openPositions.map((p) => p.market).filter(Boolean))];
writeJson(OPEN_MARKETS_PATH, {
  updatedAt: snapshot.collectedAt,
  markets: openMarkets
});

const allTrades = readJsonl(TRADES_PATH);
const portfolio = portfolioSnapshot(result.state);
const tradeStats = statsFromTrades(allTrades);

const latest = {
  version: "1.0",
  model: result.state.model,
  mode: "shadow",
  affectsLiveTrading: false,
  affectsFrozenProtocol: false,
  status: allTrades.length >= PORTFOLIO_SHADOW_MIN_CLOSED_TRADES
    ? "INTERPRETABLE"
    : "COLLECTING",
  minimumClosedTradesBeforeInterpretation: PORTFOLIO_SHADOW_MIN_CLOSED_TRADES,
  startedAtSnapshot: result.state.startedAtSnapshot,
  updatedAtSnapshot: snapshot.collectedAt,
  policy: PORTFOLIO_SHADOW_POLICY,
  methodology: [
    "Prospective only: positions are created from the same strict BUY signals, but the shadow portfolio can hold up to three positions.",
    "Combined estimated stop risk is capped at 3 EUR and position notional at 100 EUR. Risk is reduced in BTC risk-off, for grade B signals, and for same-family concentration.",
    "Original target is a management checkpoint, not an automatic full exit.",
    "Management uses completed 5m/15m/1h structure, relative strength vs BTC, volume, order-book imbalance and BTC regime.",
    "Stop changes are decisions after completed bars and only affect subsequent bars. Same-candle stop+target ambiguity is resolved conservatively in favor of the stop.",
    "This module never places, modifies or cancels live orders and never changes the frozen entry engine."
  ],
  portfolio,
  tradeStats,
  stats: result.state.stats,
  openedThisRun: result.openedPositions,
  closedThisRun: result.closedTrades.map((t) => ({
    market: t.market,
    exitReason: t.exitReason,
    netPnlEur: t.netPnlEur,
    netR: t.netR
  })),
  skippedEntriesThisRun: result.skippedEntries,
  monitoringGapsThisRun: result.monitoringGaps,
  openPositions: result.state.openPositions.map((p) => ({
    market: p.market,
    family: p.family,
    tradeGrade: p.tradeGrade,
    openedAt: p.openedAt,
    entry: p.entry,
    currentStop: p.currentStop,
    targetReference: p.targetReference,
    targetZoneReached: p.targetZoneReached,
    partialTaken: p.partialTaken,
    remainingFraction: p.remainingFraction,
    amountEur: p.amountEur,
    plannedRiskEur: p.plannedRiskEur,
    estimatedRiskEur: estimatedPositionRiskEur(p),
    lastDecision: p.lastDecision,
    lastDecisionAt: p.lastDecisionAt,
    thesis: p.currentThesis
  }))
};

writeJson(LATEST_PATH, latest);

console.log(JSON.stringify({
  snapshot: snapshot.collectedAt,
  mode: "shadow",
  openedPositions: result.openedPositions,
  closedTradesThisRun: result.closedTrades.length,
  openPositions: openMarkets,
  estimatedPortfolioRiskEur: portfolio.estimatedRiskEur,
  realizedEquityEur: portfolio.realizedEquityEur,
  status: latest.status
}, null, 2));
