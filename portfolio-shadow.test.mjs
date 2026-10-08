import assert from "node:assert/strict";
import {
  PORTFOLIO_SHADOW_POLICY,
  estimatedPositionRiskEur,
  newPortfolioShadowState,
  processPortfolioShadowState,
  portfolioSnapshot
} from "./portfolio-shadow-lib.js";

const t0 = Date.parse("2026-10-08T10:00:00Z");

function quality() {
  return {
    "5m": { ok: true },
    "15m": { ok: true },
    "1h": { ok: true }
  };
}

function metrics({
  trend5 = 1,
  trend15 = 1,
  trend1h = 1,
  rel1h = 0.8,
  rel4h = 0.6,
  volume = 1.5,
  breakdown15 = false,
  breakdown1h = false,
  ema5 = 102,
  ema15 = 102,
  atr5 = 1,
  atr15 = 2
} = {}) {
  return {
    "5m": {
      last: 100,
      trend: trend5,
      breakout: false,
      breakdown: false,
      volumeRatio: volume,
      ema20: ema5,
      atr: atr5,
      low20: 97
    },
    "15m": {
      last: 100,
      trend: trend15,
      breakout: false,
      breakdown: breakdown15,
      volumeRatio: 1,
      ema20: ema15,
      atr: atr15,
      low20: 96
    },
    "1h": {
      last: 100,
      trend: trend1h,
      breakout: false,
      breakdown: breakdown1h,
      volumeRatio: 1,
      ema20: 101,
      atr: 3,
      low20: 94
    },
    relative1hVsBTC: rel1h,
    relative4hVsBTC: rel4h,
    book: { imbalance: 0.15 }
  };
}

function buySignal(market, extra = {}) {
  return {
    market,
    action: "BUY",
    setupState: "TRIGGERED",
    family: "momentum/relative strength",
    tradeGrade: "A",
    score: 9,
    trigger: true,
    btcRegime: "risk-off",
    entry: 100,
    stop: 98,
    target: 104,
    roundTripCostPct: 0.5,
    suggestedRiskEur: 1.25,
    suggestedAmountEur: null,
    dataQuality: quality(),
    metrics: metrics(),
    ...extra
  };
}

function waitSignal(market, metricOverrides = {}) {
  return {
    ...buySignal(market, {
      action: "WAIT",
      trigger: false,
      btcRegime: "neutral",
      metrics: metrics(metricOverrides)
    })
  };
}

function bar(ts, open, high, low, close) {
  return [ts, String(open), String(high), String(low), String(close), "10"];
}

function snapshot(at, barsByMarket) {
  return {
    collectedAt: at,
    deep: Object.fromEntries(
      Object.entries(barsByMarket).map(([market, bars]) => [
        market,
        { candles: { "5m": bars } }
      ])
    )
  };
}

// V1 can hold three strict-quality signals simultaneously while respecting
// the 3 EUR combined-risk budget. A fourth simultaneous signal is skipped.
let s = newPortfolioShadowState();
let snap = snapshot("2026-10-08T10:10:00.000Z", {
  "AAA-EUR": [bar(t0, 100, 101, 99, 100)],
  "BBB-EUR": [bar(t0, 100, 101, 99, 100)],
  "CCC-EUR": [bar(t0, 100, 101, 99, 100)],
  "DDD-EUR": [bar(t0, 100, 101, 99, 100)]
});
let signals = {
  snapshotCollectedAt: snap.collectedAt,
  signals: [
    buySignal("AAA-EUR"),
    buySignal("BBB-EUR"),
    buySignal("CCC-EUR"),
    buySignal("DDD-EUR")
  ]
};
let r = processPortfolioShadowState(s, signals, snap);
s = r.state;

assert.equal(s.openPositions.length, 3);
assert.equal(r.openedPositions.length, 3);
assert.equal(r.skippedEntries.length, 1);
assert.equal(r.skippedEntries[0].reason, "max portfolio positions reached");
assert.ok(portfolioSnapshot(s).estimatedRiskEur <= PORTFOLIO_SHADOW_POLICY.maxCombinedRiskEur + 1e-9);
assert.ok(s.openPositions.every((p) => p.plannedRiskEur < 1.25)); // risk-off sizing
assert.ok(s.openPositions.every((p) => estimatedPositionRiskEur(p) > 0));

// On the next completed candle:
// - AAA reaches the target zone with strong context and becomes a runner.
// - BBB reaches the target zone without strong continuation and takes 50%.
// - CCC does not hit its stop, but its 1h thesis breaks and exits at close.
snap = snapshot("2026-10-08T10:15:00.000Z", {
  "AAA-EUR": [bar(t0 + 10*60*1000, 100, 104.5, 99.5, 104.2)],
  "BBB-EUR": [bar(t0 + 10*60*1000, 100, 104.2, 99.5, 103.5)],
  "CCC-EUR": [bar(t0 + 10*60*1000, 100, 101, 99.2, 99.8)],
  "EEE-EUR": [bar(t0 + 10*60*1000, 100, 101, 99, 100)]
});
signals = {
  snapshotCollectedAt: snap.collectedAt,
  signals: [
    waitSignal("AAA-EUR", {
      trend5: 1, trend15: 1, trend1h: 1, rel1h: 1, rel4h: 0.8,
      ema5: 103, ema15: 103, atr5: 1, atr15: 2
    }),
    waitSignal("BBB-EUR", {
      trend5: 1, trend15: 0, trend1h: 0, rel1h: 0.1, rel4h: 0,
      volume: 0.8, ema5: 102.5, ema15: 101, atr5: 1, atr15: 2
    }),
    waitSignal("CCC-EUR", {
      trend5: 0, trend15: 0, trend1h: -1, rel1h: -0.6, rel4h: -0.5,
      volume: 0.7, ema5: 100, ema15: 100, atr5: 1, atr15: 2
    }),
    buySignal("EEE-EUR", {
      btcRegime: "neutral",
      family: "trend pullback",
      score: 10
    })
  ]
};
r = processPortfolioShadowState(s, signals, snap);
s = r.state;

const aaa = s.openPositions.find((p) => p.market === "AAA-EUR");
const bbb = s.openPositions.find((p) => p.market === "BBB-EUR");
const eee = s.openPositions.find((p) => p.market === "EEE-EUR");
const cccClosed = r.closedTrades.find((t) => t.market === "CCC-EUR");

assert.ok(aaa);
assert.equal(aaa.targetZoneReached, true);
assert.equal(aaa.partialTaken, false);
assert.equal(aaa.lastDecision, "LET_WINNER_RUN");
assert.ok(aaa.currentStop > aaa.initialStop);

assert.ok(bbb);
assert.equal(bbb.targetZoneReached, true);
assert.equal(bbb.partialTaken, true);
assert.equal(Number(bbb.remainingFraction.toFixed(6)), 0.5);
assert.equal(bbb.lastDecision, "PARTIAL_TAKE_PROFIT");
assert.ok(bbb.realizedPnlEur > 0);

assert.ok(cccClosed);
assert.equal(cccClosed.exitReason, "THESIS_BROKEN");
assert.ok(eee); // freed capacity/risk can be reused by a fresh signal
assert.equal(s.openPositions.length, 3);
assert.ok(portfolioSnapshot(s).estimatedRiskEur <= 3 + 1e-9);

// AAA's tightened stop was decided after the previous completed candle.
// It only becomes effective on this following candle.
const aaaStop = aaa.currentStop;
snap = snapshot("2026-10-08T10:20:00.000Z", {
  "AAA-EUR": [bar(t0 + 15*60*1000, 104.2, 105, aaaStop - 0.1, aaaStop + 0.2)],
  "BBB-EUR": [bar(t0 + 15*60*1000, 103.5, 104, 103, 103.6)],
  "EEE-EUR": [bar(t0 + 15*60*1000, 100, 101, 99.5, 100.5)]
});
signals = {
  snapshotCollectedAt: snap.collectedAt,
  signals: [
    waitSignal("AAA-EUR"),
    waitSignal("BBB-EUR"),
    waitSignal("EEE-EUR")
  ]
};
r = processPortfolioShadowState(s, signals, snap);
s = r.state;
const aaaClosed = r.closedTrades.find((t) => t.market === "AAA-EUR");
assert.ok(aaaClosed);
assert.equal(aaaClosed.exitReason, "DYNAMIC_STOP");
assert.equal(Number(aaaClosed.exitPrice.toFixed(8)), Number(aaaStop.toFixed(8)));

// Conservative same-candle ordering: if initial stop and target are both hit,
// the initial stop wins and the trade is marked ambiguous.
let s2 = newPortfolioShadowState();
snap = snapshot("2026-10-08T11:10:00.000Z", {
  "ZZZ-EUR": [bar(Date.parse("2026-10-08T11:00:00Z"), 100, 101, 99, 100)]
});
signals = {
  snapshotCollectedAt: snap.collectedAt,
  signals: [buySignal("ZZZ-EUR", { btcRegime: "neutral" })]
};
r = processPortfolioShadowState(s2, signals, snap);
s2 = r.state;

snap = snapshot("2026-10-08T11:15:00.000Z", {
  "ZZZ-EUR": [bar(Date.parse("2026-10-08T11:10:00Z"), 100, 105, 97, 101)]
});
signals = {
  snapshotCollectedAt: snap.collectedAt,
  signals: [waitSignal("ZZZ-EUR")]
};
r = processPortfolioShadowState(s2, signals, snap);
assert.equal(r.closedTrades.length, 1);
assert.equal(r.closedTrades[0].exitReason, "INITIAL_STOP");
assert.equal(r.closedTrades[0].ambiguousTargetStopSameCandle, true);

console.log("portfolio shadow v1 tests: OK");
