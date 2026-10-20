// Read-only shadow policy. Never import into the live Worker.
const EXACT_DAILY_HALT = /^daily realized loss limit reached \(€-((?:0|[1-9]\d*)(?:\.\d{1,2})?)\)$/;
const STRICT_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const decision = (isDailyLossHalt, shouldClear, blockReason, currentUtcDayPnlEur = null) =>
  ({isDailyLossHalt, shouldClear, blockReason, currentUtcDayPnlEur});

export function evaluateDailyLossResetPolicy(input = {}) {
  const state = input && typeof input === "object" ? input : {};
  const { autoTradingHalted, autoTradingHaltReason, autoTradeHistory, nowMs, limitEur = 5 } = state;
  const match = typeof autoTradingHaltReason === "string" ?
    EXACT_DAILY_HALT.exec(autoTradingHaltReason) : null;
  const isDailyLossHalt = autoTradingHalted === true && match !== null;
  if (!isDailyLossHalt) return decision(false, false, "not-exact-daily-loss-halt");
  if (!Number.isFinite(limitEur) || limitEur <= 0) return decision(true, false, "invalid-daily-limit");
  if (Number(match[1]) < limitEur) return decision(true, false, "recorded-loss-below-limit");
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs) ||
      !Number.isFinite(new Date(nowMs).getTime())) {
    return decision(true, false, "invalid-current-time");
  }
  if (!Array.isArray(autoTradeHistory)) return decision(true, false, "missing-trade-history");
  const day = new Date(nowMs).toISOString().slice(0, 10);
  let pnl = 0;
  for (const trade of autoTradeHistory) {
    if (!trade || typeof trade !== "object" || typeof trade.closedAt !== "string" ||
        !STRICT_UTC_TIMESTAMP.test(trade.closedAt)) {
      return decision(true, false, "invalid-trade-timestamp");
    }
    const timestamp = Date.parse(trade.closedAt);
    if (!Number.isFinite(timestamp) || timestamp > nowMs ||
        new Date(timestamp).toISOString().slice(0, 10) !== trade.closedAt.slice(0, 10)) {
      return decision(true, false, "invalid-trade-timestamp");
    }
    if (typeof trade.realizedPnlEur !== "number" || !Number.isFinite(trade.realizedPnlEur)) {
      return decision(true, false, "invalid-trade-pnl");
    }
    if (trade.closedAt.slice(0, 10) === day) {
      pnl += trade.realizedPnlEur;
      if (!Number.isFinite(pnl)) return decision(true, false, "invalid-trade-pnl");
    }
  }
  const shouldClear = pnl > -limitEur;
  return decision(true, shouldClear, shouldClear ? null : "current-daily-loss-limit-reached", pnl);
}
