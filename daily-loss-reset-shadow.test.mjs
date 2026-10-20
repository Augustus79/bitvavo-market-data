import assert from "node:assert/strict";

const DAILY_LIMIT_EUR = 5;

function dailyRealizedPnlEur(trades, nowMs) {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return (trades || [])
    .filter((t) => String(t?.closedAt || "").startsWith(day))
    .reduce((sum, t) => sum + (Number.isFinite(Number(t?.realizedPnlEur)) ? Number(t.realizedPnlEur) : 0), 0);
}

function evaluateDailyLossResetPolicy({
  autoTradingHalted,
  autoTradingHaltReason,
  autoTradeHistory,
  nowMs,
  limitEur = DAILY_LIMIT_EUR
}) {
  const reason = String(autoTradingHaltReason || "");
  const isDailyLossHalt =
    autoTradingHalted === true &&
    /^daily realized loss limit reached \(€-?\d/.test(reason);

  const currentUtcDayPnlEur = dailyRealizedPnlEur(autoTradeHistory, nowMs);
  const shouldClear =
    isDailyLossHalt &&
    currentUtcDayPnlEur > -Math.abs(limitEur);

  return {
    isDailyLossHalt,
    currentUtcDayPnlEur,
    shouldClear
  };
}

const now = Date.parse("2026-10-20T11:30:00Z");

// Regression for the real stale-halt shape observed on 2026-10-20:
// the halt reason came from 2026-10-13, while the current UTC day has no loss.
{
  const r = evaluateDailyLossResetPolicy({
    autoTradingHalted: true,
    autoTradingHaltReason: "daily realized loss limit reached (€-5.34)",
    autoTradeHistory: [
      { closedAt: "2026-10-13T06:53:48Z", realizedPnlEur: -1.66 },
      { closedAt: "2026-10-13T13:43:50Z", realizedPnlEur: -0.61 },
      { closedAt: "2026-10-13T15:37:53Z", realizedPnlEur: -1.31 },
      { closedAt: "2026-10-13T22:39:50Z", realizedPnlEur: -1.76 }
    ],
    nowMs: now
  });
  assert.equal(r.isDailyLossHalt, true);
  assert.equal(r.currentUtcDayPnlEur, 0);
  assert.equal(r.shouldClear, true);
}

// Same-day loss at the threshold must remain halted.
{
  const r = evaluateDailyLossResetPolicy({
    autoTradingHalted: true,
    autoTradingHaltReason: "daily realized loss limit reached (€-5.00)",
    autoTradeHistory: [
      { closedAt: "2026-10-20T08:00:00Z", realizedPnlEur: -2 },
      { closedAt: "2026-10-20T10:00:00Z", realizedPnlEur: -3 }
    ],
    nowMs: now
  });
  assert.equal(r.currentUtcDayPnlEur, -5);
  assert.equal(r.shouldClear, false);
}

// Same-day loss worse than the threshold must remain halted.
{
  const r = evaluateDailyLossResetPolicy({
    autoTradingHalted: true,
    autoTradingHaltReason: "daily realized loss limit reached (€-5.34)",
    autoTradeHistory: [
      { closedAt: "2026-10-20T08:00:00Z", realizedPnlEur: -5.34 }
    ],
    nowMs: now
  });
  assert.equal(r.currentUtcDayPnlEur, -5.34);
  assert.equal(r.shouldClear, false);
}

// If the current UTC day has recovered above the threshold, the daily-only halt may clear.
{
  const r = evaluateDailyLossResetPolicy({
    autoTradingHalted: true,
    autoTradingHaltReason: "daily realized loss limit reached (€-5.34)",
    autoTradeHistory: [
      { closedAt: "2026-10-20T08:00:00Z", realizedPnlEur: -5.34 },
      { closedAt: "2026-10-20T10:30:00Z", realizedPnlEur: 0.35 }
    ],
    nowMs: now
  });
  assert.ok(r.currentUtcDayPnlEur > -5);
  assert.equal(r.shouldClear, true);
}

// Critical halts must never be cleared by the daily reset policy.
for (const criticalReason of [
  "CRITICAL: entry filled on X-EUR but stop and emergency exit both failed",
  "protective stop failed after X-EUR entry; emergency exit submitted",
  "live trading credentials missing while auto position exists",
  "CRITICAL: target exit and stop restoration failed for X-EUR"
]) {
  const r = evaluateDailyLossResetPolicy({
    autoTradingHalted: true,
    autoTradingHaltReason: criticalReason,
    autoTradeHistory: [],
    nowMs: now
  });
  assert.equal(r.isDailyLossHalt, false);
  assert.equal(r.shouldClear, false);
}

// An already-running state must not be changed by this policy.
{
  const r = evaluateDailyLossResetPolicy({
    autoTradingHalted: false,
    autoTradingHaltReason: null,
    autoTradeHistory: [],
    nowMs: now
  });
  assert.equal(r.shouldClear, false);
}

// UTC boundary is explicit: a loss at 23:59:59Z belongs to the previous day,
// and must not contaminate 00:00:00Z of the next UTC day.
{
  const r = evaluateDailyLossResetPolicy({
    autoTradingHalted: true,
    autoTradingHaltReason: "daily realized loss limit reached (€-5.20)",
    autoTradeHistory: [
      { closedAt: "2026-10-19T23:59:59Z", realizedPnlEur: -5.20 }
    ],
    nowMs: Date.parse("2026-10-20T00:00:00Z")
  });
  assert.equal(r.currentUtcDayPnlEur, 0);
  assert.equal(r.shouldClear, true);
}

console.log("daily-loss reset shadow policy tests: OK");
