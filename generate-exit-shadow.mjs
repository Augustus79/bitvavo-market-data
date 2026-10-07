import fs from "node:fs";
import {
  EXIT_SHADOW_POLICIES,
  EXIT_SHADOW_MIN_CLOSED_TRADES,
  newExitShadowState,
  processExitShadowState
} from "./exit-shadow-lib.js";
import { tradeStats, mean } from "./evaluation-lib.js";

const DIR = "exit-shadow";
const STATE_PATH = `${DIR}/state.json`;
const TRADES_PATH = `${DIR}/trades.jsonl`;
const EVENTS_PATH = `${DIR}/events.jsonl`;
const LATEST_PATH = `${DIR}/latest.json`;

function readJson(path, fallback) {
  if (!fs.existsSync(path)) return fallback;
  try { return JSON.parse(fs.readFileSync(path, "utf8")); } catch { return fallback; }
}
function readJsonl(path) {
  if (!fs.existsSync(path)) return [];
  return fs.readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}
function appendJsonl(path, rows) {
  if (!rows.length) return;
  fs.appendFileSync(path, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
}
function writeJson(path, value) {
  fs.writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

fs.mkdirSync(DIR, { recursive: true });

const snapshot = readJson("snapshot.json", null);
const strictState = readJson("paper/state.json", null);
if (!snapshot?.collectedAt || !strictState) throw new Error("snapshot.json or paper/state.json missing");

const existingState = readJson(STATE_PATH, newExitShadowState());
const result = processExitShadowState(existingState, strictState.openPositions || [], snapshot);

const strictTrades = readJsonl("paper/trades.jsonl");
const baselineById = new Map(strictTrades.map((t) => [t.id, t]));
const pairedClosed = result.closedTrades.map((t) => {
  const baseline = baselineById.get(t.strictPositionId) || null;
  const baselineNetR = baseline && Number(baseline.plannedRiskEur) > 0
    ? Number(baseline.netPnlEur) / Number(baseline.plannedRiskEur)
    : null;
  return {
    ...t,
    baselineExitReason: baseline?.exitReason ?? null,
    baselineNetPnlEur: baseline?.netPnlEur ?? null,
    baselineNetR,
    deltaRVsBaseline: Number.isFinite(baselineNetR) ? t.netR - baselineNetR : null
  };
});

writeJson(STATE_PATH, result.state);
appendJsonl(TRADES_PATH, pairedClosed);
appendJsonl(EVENTS_PATH, result.events);

const allTrades = readJsonl(TRADES_PATH);
const policies = {};
for (const policy of EXIT_SHADOW_POLICIES) {
  const rows = allTrades.filter((t) => t.policyId === policy.id);
  const deltas = rows.map((t) => Number(t.deltaRVsBaseline)).filter(Number.isFinite);
  const open = result.state.openPositions.filter((p) => p.policyId === policy.id);
  policies[policy.id] = {
    label: policy.label,
    takeProfitFractionAtTarget: policy.takeProfitFractionAtTarget,
    trailRiskMultiple: policy.trailRiskMultiple,
    status: rows.length >= EXIT_SHADOW_MIN_CLOSED_TRADES ? "INTERPRETABLE" : "COLLECTING",
    minimumClosedTradesBeforeInterpretation: EXIT_SHADOW_MIN_CLOSED_TRADES,
    closedTrades: rows.length,
    openTrades: open.length,
    stats: tradeStats(rows),
    pairedBaselineTrades: deltas.length,
    meanDeltaRVsBaseline: mean(deltas),
    betterThanBaseline: rows.filter((t) => Number(t.deltaRVsBaseline) > 1e-12).length,
    worseThanBaseline: rows.filter((t) => Number(t.deltaRVsBaseline) < -1e-12).length,
    sameAsBaseline: rows.filter((t) => Math.abs(Number(t.deltaRVsBaseline)) <= 1e-12).length,
    targetReachedTrades: rows.filter((t) => t.targetReached).length,
    bestNetR: rows.length ? Math.max(...rows.map((t) => Number(t.netR)).filter(Number.isFinite)) : null
  };
}

const latest = {
  version: "1.0",
  mode: "shadow",
  affectsLiveTrading: false,
  affectsFrozenProtocol: false,
  methodology: "Prospective only. Alternative exits are followed on completed 5m candles after the exact strict entry. Original hard stop remains until target activation. Trailing-stop updates are bar-close decisions effective on the next 5m candle. Same-candle original stop+target ambiguity resolves to stop first.",
  startedAtSnapshot: result.state.startedAtSnapshot,
  updatedAtSnapshot: snapshot.collectedAt,
  minimumClosedTradesBeforeInterpretation: EXIT_SHADOW_MIN_CLOSED_TRADES,
  enrolledStrictPositionsThisRun: result.enrolledStrictPositions,
  monitoringGapsThisRun: result.monitoringGaps,
  openShadowPositions: result.state.openPositions.map((p) => ({
    strictPositionId: p.strictPositionId,
    policyId: p.policyId,
    market: p.market,
    targetReached: p.targetReached,
    currentStop: p.currentStop,
    remainingFraction: p.remainingFraction
  })),
  policies
};
writeJson(LATEST_PATH, latest);

console.log(JSON.stringify({
  snapshot: snapshot.collectedAt,
  enrolledStrictPositions: result.enrolledStrictPositions,
  closedShadowTradesThisRun: pairedClosed.length,
  openShadowPositions: result.state.openPositions.length,
  policyStatus: Object.fromEntries(Object.entries(policies).map(([k,v]) => [k, { closedTrades:v.closedTrades, status:v.status, meanDeltaRVsBaseline:v.meanDeltaRVsBaseline }]))
}, null, 2));
