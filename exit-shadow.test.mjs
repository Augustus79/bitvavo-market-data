import assert from "node:assert/strict";
import {
  EXIT_SHADOW_POLICIES,
  newExitShadowState,
  processExitShadowState
} from "./exit-shadow-lib.js";

const t0 = Date.parse("2026-10-07T10:00:00Z");
const strict = {
  id: "strict|AAA-EUR|2026-10-07T10:10:00.000Z",
  market: "AAA-EUR",
  family: "trend pullback",
  tradeGrade: "A",
  openedAt: "2026-10-07T10:10:00.000Z",
  signalSnapshotAt: "2026-10-07T10:10:00.000Z",
  entry: 100,
  stop: 98,
  target: 104,
  amountEur: 50,
  quantity: 0.5,
  plannedRiskEur: 1.25,
  roundTripCostPct: 0.5,
  btcRegimeAtEntry: "neutral",
  lastEvaluatedCandleOpenTime: t0 + 5 * 60 * 1000
};

let snapshot = {
  collectedAt: "2026-10-07T10:10:00.000Z",
  deep: { "AAA-EUR": { candles: { "5m": [] } } }
};
let r = processExitShadowState(newExitShadowState(), [strict], snapshot);
assert.equal(r.enrolledStrictPositions.length, 1);
assert.equal(r.state.openPositions.length, EXIT_SHADOW_POLICIES.length);

// Target is reached. No shadow exits at the fixed target; the runner stop
// becomes effective only after this completed candle.
snapshot = {
  collectedAt: "2026-10-07T10:15:00.000Z",
  deep: { "AAA-EUR": { candles: { "5m": [
    [t0 + 10*60*1000, "100", "104.5", "99.5", "104.2", "1"]
  ] } } }
};
r = processExitShadowState(r.state, [], snapshot);
assert.equal(r.closedTrades.length, 0);
assert.equal(r.state.openPositions.length, 3);
assert.ok(r.state.openPositions.every((p) => p.targetReached));

// Strong continuation lets the 1R runner ratchet its stop above the old TP.
snapshot = {
  collectedAt: "2026-10-07T10:20:00.000Z",
  deep: { "AAA-EUR": { candles: { "5m": [
    [t0 + 15*60*1000, "104.2", "107", "103", "106.5", "1"],
    [t0 + 10*60*1000, "100", "104.5", "99.5", "104.2", "1"]
  ] } } }
};
r = processExitShadowState(r.state, [], snapshot);
assert.equal(r.closedTrades.length, 0);
const oneR = r.state.openPositions.find((p) => p.policyId === "full-runner-trail-1r");
assert.equal(Number(oneR.currentStop.toFixed(6)), 105);

// Retrace closes 1R runners at 105, above the old target 104.
snapshot = {
  collectedAt: "2026-10-07T10:25:00.000Z",
  deep: { "AAA-EUR": { candles: { "5m": [
    [t0 + 20*60*1000, "106.5", "106", "104.5", "105", "1"],
    [t0 + 15*60*1000, "104.2", "107", "103", "106.5", "1"]
  ] } } }
};
r = processExitShadowState(r.state, [], snapshot);
assert.equal(r.closedTrades.length, 2);
const full = r.closedTrades.find((t) => t.policyId === "full-runner-trail-1r");
const half = r.closedTrades.find((t) => t.policyId === "half-target-runner-trail-1r");
assert.equal(full.finalExitPrice, 105);
assert.ok(full.netPnlEur > 50 * ((104 - 100) / 100 - 0.005));
assert.equal(half.legs[0].type, "TARGET_PARTIAL");
assert.equal(half.legs[0].fraction, 0.5);
assert.ok(half.netPnlEur > 50 * ((104 - 100) / 100 - 0.005));

// Wider 1.5R trail survives one bar longer, then exits at its prior stop.
snapshot = {
  collectedAt: "2026-10-07T10:30:00.000Z",
  deep: { "AAA-EUR": { candles: { "5m": [
    [t0 + 25*60*1000, "105", "108", "103.5", "104", "1"],
    [t0 + 20*60*1000, "106.5", "106", "104.5", "105", "1"]
  ] } } }
};
r = processExitShadowState(r.state, [], snapshot);
assert.equal(r.closedTrades.length, 1);
assert.equal(r.closedTrades[0].policyId, "full-runner-trail-1_5r");
assert.equal(r.closedTrades[0].finalExitPrice, 104);

// If stop and target coexist in the same pre-activation 5m candle, stop wins.
const strict2 = {
  ...strict,
  id: "strict|BBB-EUR|2026-10-07T11:10:00.000Z",
  market: "BBB-EUR",
  openedAt: "2026-10-07T11:10:00.000Z",
  signalSnapshotAt: "2026-10-07T11:10:00.000Z",
  lastEvaluatedCandleOpenTime: t0 + 65 * 60 * 1000
};
snapshot = {
  collectedAt: "2026-10-07T11:10:00.000Z",
  deep: { "BBB-EUR": { candles: { "5m": [] } } }
};
let q = processExitShadowState(newExitShadowState(), [strict2], snapshot);
snapshot = {
  collectedAt: "2026-10-07T11:15:00.000Z",
  deep: { "BBB-EUR": { candles: { "5m": [
    [t0 + 70*60*1000, "100", "105", "97", "101", "1"]
  ] } } }
};
q = processExitShadowState(q.state, [], snapshot);
assert.equal(q.closedTrades.length, 3);
assert.ok(q.closedTrades.every((t) => t.exitReason === "STOP_BEFORE_TARGET"));
assert.ok(q.closedTrades.every((t) => t.ambiguousTargetStopSameCandle === true));

console.log("exit shadow tests: OK");
