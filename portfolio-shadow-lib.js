import { closed5mBars } from "./paper-trader.js";

export const PORTFOLIO_SHADOW_MIN_CLOSED_TRADES = 30;

export const PORTFOLIO_SHADOW_POLICY = Object.freeze({
  id: "dynamic-portfolio-v1",
  maxPositions: 3,
  maxCombinedRiskEur: 3,
  maxNotionalPerPositionEur: 100,
  startingCapitalEur: 300,
  riskOffMultiplier: 0.75,
  gradeBMultiplier: 0.8,
  sameFamilyMultiplier: 0.8,
  targetPartialFraction: 0.5
});

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v) {
  return clamp(Number(v) || 0, 0, 1);
}

function round(v, digits = 8) {
  return Number(Number(v).toFixed(digits));
}

function regimeMultiplier(regime) {
  return regime === "risk-off" ? PORTFOLIO_SHADOW_POLICY.riskOffMultiplier : 1;
}

function costAdjustedBreakeven(entry, roundTripCostPct) {
  const e = n(entry);
  const c = n(roundTripCostPct);
  if (!(e > 0) || !(c >= 0)) return null;
  return e * (1 + c / 100);
}

function legNetPnlEur(position, fraction, exitPrice) {
  const f = clamp01(fraction);
  const entry = n(position?.entry);
  const exit = n(exitPrice);
  const costs = n(position?.roundTripCostPct);
  const amount = n(position?.amountEur);
  if (!(f > 0 && entry > 0 && exit > 0 && costs >= 0 && amount > 0)) return 0;
  const grossPct = 100 * (exit - entry) / entry;
  const netPct = grossPct - costs;
  return amount * f * netPct / 100;
}

function openAllocatedEur(positions) {
  return (positions || []).reduce(
    (sum, p) => sum + (n(p.amountEur) || 0) * clamp01(p.remainingFraction ?? 1),
    0
  );
}

export function estimatedPositionRiskEur(position) {
  const entry = n(position?.entry);
  const stop = n(position?.currentStop);
  const costs = n(position?.roundTripCostPct);
  const amount = n(position?.amountEur);
  const fraction = clamp01(position?.remainingFraction ?? 1);
  if (!(entry > 0 && stop > 0 && costs >= 0 && amount > 0 && fraction > 0)) return 0;
  const downsidePct = 100 * (entry - stop) / entry + costs;
  return amount * fraction * Math.max(0, downsidePct) / 100;
}

function combinedRiskEur(positions) {
  return (positions || []).reduce((sum, p) => sum + estimatedPositionRiskEur(p), 0);
}

function dataQualityOk(signal) {
  const q = Object.values(signal?.dataQuality || {});
  return q.length > 0 && q.every((x) => x?.ok === true);
}

function validStrictBuySignal(signal) {
  const entry = n(signal?.entry);
  const stop = n(signal?.stop);
  const target = n(signal?.target);
  const costs = n(signal?.roundTripCostPct);
  const risk = n(signal?.suggestedRiskEur);
  return Boolean(
    signal?.action === "BUY" &&
    signal?.trigger === true &&
    (signal?.tradeGrade === "A" || signal?.tradeGrade === "B") &&
    dataQualityOk(signal) &&
    entry > 0 &&
    stop > 0 &&
    stop < entry &&
    target > entry &&
    costs !== null &&
    costs >= 0 &&
    risk > 0
  );
}

function netRiskPct(entry, stop, costs) {
  return 100 * (entry - stop) / entry + costs;
}

function contextSnapshot(signal, decisionPrice = null) {
  const m5 = signal?.metrics?.["5m"] || {};
  const m15 = signal?.metrics?.["15m"] || {};
  const m1h = signal?.metrics?.["1h"] || {};
  const rel1h = n(signal?.metrics?.relative1hVsBTC);
  const rel4h = n(signal?.metrics?.relative4hVsBTC);
  const bookImbalance = n(signal?.metrics?.book?.imbalance);

  let score = 0;
  const reasons = [];

  const addTrend = (name, trend, positive, negative) => {
    const t = n(trend);
    if (t === 1) {
      score += positive;
      reasons.push(`${name} uptrend`);
    } else if (t === -1) {
      score -= negative;
      reasons.push(`${name} downtrend`);
    }
  };

  addTrend("1h", m1h.trend, 2, 2);
  addTrend("15m", m15.trend, 1.5, 1.5);
  addTrend("5m", m5.trend, 0.5, 0.5);

  if (rel1h !== null) {
    if (rel1h >= 0.5) {
      score += 1;
      reasons.push("strong 1h relative strength vs BTC");
    } else if (rel1h > 0) {
      score += 0.5;
      reasons.push("positive 1h relative strength vs BTC");
    } else if (rel1h <= -0.5) {
      score -= 1;
      reasons.push("weak 1h relative strength vs BTC");
    } else if (rel1h < 0) {
      score -= 0.5;
      reasons.push("negative 1h relative strength vs BTC");
    }
  }

  if (rel4h !== null) {
    if (rel4h >= 0.5) score += 0.5;
    else if (rel4h <= -0.5) score -= 0.5;
  }

  const volumeRatio5m = n(m5.volumeRatio);
  if (volumeRatio5m !== null) {
    if (volumeRatio5m >= 1.2) {
      score += 0.5;
      reasons.push("active 5m volume");
    } else if (volumeRatio5m < 0.5) {
      score -= 0.25;
      reasons.push("thin 5m volume");
    }
  }

  if (bookImbalance !== null) {
    if (bookImbalance >= 0.1) score += 0.25;
    else if (bookImbalance <= -0.1) score -= 0.25;
  }

  if (signal?.btcRegime === "risk-off") {
    score -= 0.75;
    reasons.push("BTC risk-off");
  } else if (signal?.btcRegime === "risk-on") {
    score += 0.5;
    reasons.push("BTC risk-on");
  }

  if (m15.breakdown === true) {
    score -= 1.25;
    reasons.push("15m breakdown");
  }
  if (m1h.breakdown === true) {
    score -= 1.75;
    reasons.push("1h breakdown");
  }
  if (m15.breakout === true) score += 0.5;
  if (m1h.breakout === true) score += 0.75;

  const trend1h = n(m1h.trend);
  const trend15m = n(m15.trend);
  const broken = Boolean(
    (trend1h === -1 && trend15m !== 1) ||
    (m1h.breakdown === true) ||
    (m15.breakdown === true && rel1h !== null && rel1h < 0)
  );

  const strong = Boolean(
    score >= 2.5 &&
    trend1h !== -1 &&
    trend15m !== -1 &&
    !(m15.breakdown === true || m1h.breakdown === true)
  );

  return {
    score: round(score, 4),
    state: broken ? "BROKEN" : strong ? "STRONG" : score <= -0.75 ? "WEAK" : "NEUTRAL",
    strong,
    broken,
    decisionPrice: n(decisionPrice),
    btcRegime: signal?.btcRegime ?? null,
    trend5m: n(m5.trend),
    trend15m,
    trend1h,
    relative1hVsBTC: rel1h,
    relative4hVsBTC: rel4h,
    atr5m: n(m5.atr),
    atr15m: n(m15.atr),
    ema20_5m: n(m5.ema20),
    ema20_15m: n(m15.ema20),
    low20_5m: n(m5.low20),
    low20_15m: n(m15.low20),
    volumeRatio5m,
    bookImbalance,
    reasons
  };
}

function latestClosedBar(snapshot, market) {
  const asOfMs = Date.parse(snapshot?.collectedAt);
  if (!Number.isFinite(asOfMs)) return null;
  const bars = closed5mBars(snapshot?.deep?.[market]?.candles?.["5m"], asOfMs);
  return bars.length ? bars[bars.length - 1] : null;
}

function makePosition(state, signal, snapshot) {
  const entry = n(signal.entry);
  const stop = n(signal.stop);
  const target = n(signal.target);
  const costs = n(signal.roundTripCostPct);
  const rawRiskBudget = Math.min(
    PORTFOLIO_SHADOW_POLICY.maxCombinedRiskEur,
    n(signal.suggestedRiskEur) || 0
  );
  if (!(entry > 0 && stop > 0 && target > entry && costs >= 0 && rawRiskBudget > 0)) return null;

  const sameFamilyCount = state.openPositions.filter((p) => p.family === signal.family).length;
  let riskBudget = rawRiskBudget * regimeMultiplier(signal.btcRegime);
  if (signal.tradeGrade === "B") riskBudget *= PORTFOLIO_SHADOW_POLICY.gradeBMultiplier;
  if (sameFamilyCount > 0) riskBudget *= PORTFOLIO_SHADOW_POLICY.sameFamilyMultiplier;

  const currentRisk = combinedRiskEur(state.openPositions);
  const remainingRisk = Math.max(0, PORTFOLIO_SHADOW_POLICY.maxCombinedRiskEur - currentRisk);
  riskBudget = Math.min(riskBudget, remainingRisk);

  const riskPct = netRiskPct(entry, stop, costs);
  if (!(riskPct > 0 && riskBudget > 0)) return null;

  const preferred = n(signal.suggestedAmountEur);
  const rawAmount = preferred > 0 ? preferred : riskBudget / (riskPct / 100);
  const availableCapital = Math.max(
    0,
    state.realizedEquityEur - openAllocatedEur(state.openPositions)
  );
  const amountEur = Math.min(
    rawAmount,
    PORTFOLIO_SHADOW_POLICY.maxNotionalPerPositionEur,
    availableCapital,
    riskBudget / (riskPct / 100)
  );
  if (!(amountEur > 0)) return null;

  const actualRisk = amountEur * riskPct / 100;
  const lastBar = latestClosedBar(snapshot, signal.market);
  const context = contextSnapshot(signal, lastBar?.close ?? entry);

  return {
    id: `portfolio-shadow|${signal.market}|${snapshot.collectedAt}`,
    market: signal.market,
    family: signal.family,
    tradeGrade: signal.tradeGrade,
    scoreAtEntry: n(signal.score),
    openedAt: snapshot.collectedAt,
    signalSnapshotAt: snapshot.collectedAt,
    entry,
    initialStop: stop,
    currentStop: stop,
    targetReference: target,
    targetZoneReached: false,
    targetZoneReachedAt: null,
    partialTaken: false,
    amountEur,
    quantity: amountEur / entry,
    plannedRiskEur: actualRisk,
    initialRiskBudgetEur: riskBudget,
    roundTripCostPct: costs,
    structuralRiskAbs: entry - stop,
    remainingFraction: 1,
    realizedPnlEur: 0,
    lastEvaluatedCandleOpenTime: lastBar?.ts ?? null,
    evaluatedBars: 0,
    maxFavorablePrice: entry,
    minAdversePrice: entry,
    lastDecision: "ENTER",
    lastDecisionAt: snapshot.collectedAt,
    currentThesis: context,
    entryContext: context,
    decisionHistory: [{
      at: snapshot.collectedAt,
      decision: "ENTER",
      thesisScore: context.score,
      thesisState: context.state,
      stop
    }]
  };
}

function updateEquityAfterRealization(state, pnlDelta) {
  state.realizedNetPnlEur += pnlDelta;
  state.realizedEquityEur = state.startingCapitalEur + state.realizedNetPnlEur;
  state.peakRealizedEquityEur = Math.max(state.peakRealizedEquityEur, state.realizedEquityEur);
  const dd = state.peakRealizedEquityEur - state.realizedEquityEur;
  const ddPct = state.peakRealizedEquityEur > 0
    ? 100 * dd / state.peakRealizedEquityEur
    : 0;
  state.maxRealizedDrawdownEur = Math.max(state.maxRealizedDrawdownEur, dd);
  state.maxRealizedDrawdownPct = Math.max(state.maxRealizedDrawdownPct, ddPct);
}

function closePosition(state, position, exitPrice, reason, at, extra = {}) {
  const fraction = clamp01(position.remainingFraction);
  const finalPnl = legNetPnlEur(position, fraction, exitPrice);
  updateEquityAfterRealization(state, finalPnl);
  const totalPnl = (n(position.realizedPnlEur) || 0) + finalPnl;
  const legs = [...(position.legs || [])];
  if (fraction > 0) {
    legs.push({
      type: "FINAL_EXIT",
      fraction,
      price: exitPrice,
      netPnlEur: finalPnl,
      at,
      reason
    });
  }

  state.stats.closedTrades += 1;
  if (totalPnl > 0) state.stats.wins += 1;
  else state.stats.losses += 1;
  if (extra.ambiguousTargetStopSameCandle) state.stats.ambiguousExits += 1;

  return {
    id: position.id,
    market: position.market,
    family: position.family,
    tradeGrade: position.tradeGrade,
    openedAt: position.openedAt,
    closedAt: at,
    entry: position.entry,
    initialStop: position.initialStop,
    finalStop: position.currentStop,
    targetReference: position.targetReference,
    exitPrice,
    exitReason: reason,
    targetZoneReached: position.targetZoneReached,
    partialTaken: position.partialTaken,
    amountEur: position.amountEur,
    plannedRiskEur: position.plannedRiskEur,
    roundTripCostPct: position.roundTripCostPct,
    netPnlEur: totalPnl,
    netR: position.plannedRiskEur > 0 ? totalPnl / position.plannedRiskEur : null,
    maxFavorablePrice: position.maxFavorablePrice,
    minAdversePrice: position.minAdversePrice,
    evaluatedBars: position.evaluatedBars,
    entryContext: position.entryContext,
    exitContext: position.currentThesis,
    decisionHistory: position.decisionHistory,
    legs,
    ...extra
  };
}

function evaluateBars(state, position, snapshot) {
  const asOfMs = Date.parse(snapshot?.collectedAt);
  const raw = snapshot?.deep?.[position.market]?.candles?.["5m"];
  if (!Number.isFinite(asOfMs) || !raw) {
    return { position, closedTrade: null, events: [], monitoringGap: true };
  }

  const bars = closed5mBars(raw, asOfMs)
    .filter((b) => b.ts > (position.lastEvaluatedCandleOpenTime ?? -Infinity));
  const events = [];

  for (const bar of bars) {
    const stop = n(position.currentStop) || position.initialStop;
    const hitStop = bar.low <= stop;
    const hitTarget = !position.targetZoneReached && bar.high >= position.targetReference;

    if (hitStop) {
      const closedAt = new Date(bar.ts + 5 * 60 * 1000).toISOString();
      return {
        position: null,
        closedTrade: closePosition(
          state,
          position,
          stop,
          position.targetZoneReached ? "DYNAMIC_STOP" : "INITIAL_STOP",
          closedAt,
          { ambiguousTargetStopSameCandle: Boolean(hitTarget) }
        ),
        events: [...events, {
          type: "POSITION_CLOSED",
          market: position.market,
          at: closedAt,
          reason: position.targetZoneReached ? "DYNAMIC_STOP" : "INITIAL_STOP"
        }],
        monitoringGap: false
      };
    }

    position.maxFavorablePrice = Math.max(position.maxFavorablePrice, bar.high);
    position.minAdversePrice = Math.min(position.minAdversePrice, bar.low);

    if (hitTarget) {
      position.targetZoneReached = true;
      position.targetZoneReachedAt = new Date(bar.ts + 5 * 60 * 1000).toISOString();
      events.push({
        type: "TARGET_ZONE_REACHED",
        market: position.market,
        at: position.targetZoneReachedAt,
        targetReference: position.targetReference
      });
    }

    position.lastEvaluatedCandleOpenTime = bar.ts;
    position.evaluatedBars += 1;
  }

  return { position, closedTrade: null, events, monitoringGap: false };
}

function safeStopCandidate(position, thesis, decisionPrice, mode) {
  const current = n(position.currentStop) || position.initialStop;
  const breakeven = costAdjustedBreakeven(position.entry, position.roundTripCostPct);
  const atr5 = n(thesis.atr5m);
  const atr15 = n(thesis.atr15m);
  const ema5 = n(thesis.ema20_5m);
  const ema15 = n(thesis.ema20_15m);

  const candidates = [current];
  if (breakeven !== null) candidates.push(breakeven);

  if (mode === "runner" && ema15 !== null && atr15 !== null && atr15 > 0) {
    candidates.push(ema15 - 0.5 * atr15);
  }
  if (mode === "protect" && ema5 !== null && atr5 !== null && atr5 > 0) {
    candidates.push(ema5 - 0.5 * atr5);
  }

  let proposed = Math.max(...candidates.filter(Number.isFinite));
  const minBuffer = atr5 !== null && atr5 > 0 ? 0.25 * atr5 : 0;
  const maxAllowed = decisionPrice - minBuffer;
  proposed = Math.min(proposed, maxAllowed);
  return proposed > current ? proposed : current;
}

function applyManagementDecision(state, position, signal, snapshot) {
  if (!signal) {
    position.lastDecision = "HOLD_NO_CONTEXT";
    position.lastDecisionAt = snapshot.collectedAt;
    position.decisionHistory.push({
      at: snapshot.collectedAt,
      decision: "HOLD_NO_CONTEXT",
      thesisScore: null,
      thesisState: "UNKNOWN",
      stop: position.currentStop
    });
    return { position, closedTrade: null, events: [] };
  }

  const lastBar = latestClosedBar(snapshot, position.market);
  const decisionPrice = n(lastBar?.close) ?? n(signal?.metrics?.["5m"]?.last);
  if (!(decisionPrice > 0)) {
    return { position, closedTrade: null, events: [] };
  }

  const thesis = contextSnapshot(signal, decisionPrice);
  position.currentThesis = thesis;
  const profitR = position.structuralRiskAbs > 0
    ? (decisionPrice - position.entry) / position.structuralRiskAbs
    : null;
  const events = [];

  if (thesis.broken) {
    const closedTrade = closePosition(
      state,
      position,
      decisionPrice,
      "THESIS_BROKEN",
      snapshot.collectedAt
    );
    events.push({
      type: "POSITION_CLOSED",
      market: position.market,
      at: snapshot.collectedAt,
      reason: "THESIS_BROKEN",
      thesisScore: thesis.score
    });
    return { position: null, closedTrade, events };
  }

  let decision = "HOLD";
  let nextStop = position.currentStop;

  if (position.targetZoneReached && thesis.strong) {
    decision = "LET_WINNER_RUN";
    nextStop = safeStopCandidate(position, thesis, decisionPrice, "runner");
  } else if (position.targetZoneReached && !position.partialTaken) {
    decision = "PARTIAL_TAKE_PROFIT";
    const fraction = Math.min(
      PORTFOLIO_SHADOW_POLICY.targetPartialFraction,
      position.remainingFraction
    );
    const pnl = legNetPnlEur(position, fraction, decisionPrice);
    position.realizedPnlEur += pnl;
    position.remainingFraction = clamp01(position.remainingFraction - fraction);
    position.partialTaken = true;
    position.legs ||= [];
    position.legs.push({
      type: "DYNAMIC_PARTIAL",
      fraction,
      price: decisionPrice,
      netPnlEur: pnl,
      at: snapshot.collectedAt,
      reason: "target zone reached without strong continuation context"
    });
    updateEquityAfterRealization(state, pnl);
    state.stats.partialExits += 1;
    nextStop = safeStopCandidate(position, thesis, decisionPrice, "protect");
    events.push({
      type: "PARTIAL_TAKE_PROFIT",
      market: position.market,
      at: snapshot.collectedAt,
      fraction,
      price: decisionPrice,
      netPnlEur: pnl
    });
  } else if (position.targetZoneReached && thesis.state === "WEAK") {
    decision = "TIGHTEN_STOP";
    nextStop = safeStopCandidate(position, thesis, decisionPrice, "protect");
  } else if (profitR !== null && profitR >= 1 && thesis.state !== "STRONG") {
    decision = "TIGHTEN_STOP";
    nextStop = safeStopCandidate(position, thesis, decisionPrice, "protect");
  } else if (profitR !== null && profitR >= 1.5 && thesis.strong) {
    decision = "LET_WINNER_RUN";
    nextStop = safeStopCandidate(position, thesis, decisionPrice, "runner");
  }

  if (nextStop > position.currentStop + 1e-12) {
    events.push({
      type: "STOP_TIGHTENED",
      market: position.market,
      at: snapshot.collectedAt,
      from: position.currentStop,
      to: nextStop,
      decision
    });
    position.currentStop = nextStop;
    state.stats.stopTightenings += 1;
  }

  position.lastDecision = decision;
  position.lastDecisionAt = snapshot.collectedAt;
  position.decisionHistory.push({
    at: snapshot.collectedAt,
    decision,
    thesisScore: thesis.score,
    thesisState: thesis.state,
    decisionPrice,
    profitStructuralR: profitR,
    stop: position.currentStop,
    remainingFraction: position.remainingFraction
  });
  position.decisionHistory = position.decisionHistory.slice(-100);

  events.push({
    type: "MANAGEMENT_DECISION",
    market: position.market,
    at: snapshot.collectedAt,
    decision,
    thesisScore: thesis.score,
    thesisState: thesis.state,
    profitStructuralR: profitR,
    currentStop: position.currentStop,
    remainingFraction: position.remainingFraction
  });

  return { position, closedTrade: null, events };
}

export function newPortfolioShadowState() {
  return {
    version: "1.0",
    model: "dynamic-portfolio-shadow-v1",
    mode: "shadow",
    affectsLiveTrading: false,
    affectsFrozenProtocol: false,
    startingCapitalEur: PORTFOLIO_SHADOW_POLICY.startingCapitalEur,
    realizedNetPnlEur: 0,
    realizedEquityEur: PORTFOLIO_SHADOW_POLICY.startingCapitalEur,
    peakRealizedEquityEur: PORTFOLIO_SHADOW_POLICY.startingCapitalEur,
    maxRealizedDrawdownEur: 0,
    maxRealizedDrawdownPct: 0,
    startedAtSnapshot: null,
    lastProcessedSnapshot: null,
    openPositions: [],
    lastEntryEligibleByMarket: {},
    stats: {
      closedTrades: 0,
      wins: 0,
      losses: 0,
      ambiguousExits: 0,
      partialExits: 0,
      stopTightenings: 0,
      entriesOpened: 0,
      entriesSkippedCapacity: 0,
      entriesSkippedRisk: 0,
      monitoringGaps: 0
    }
  };
}

function migrateState(input) {
  const base = newPortfolioShadowState();
  const state = { ...base, ...(input || {}) };
  state.version = base.version;
  state.model = base.model;
  state.mode = "shadow";
  state.affectsLiveTrading = false;
  state.affectsFrozenProtocol = false;
  state.openPositions = Array.isArray(state.openPositions)
    ? state.openPositions.map((p) => ({
        ...p,
        currentStop: n(p.currentStop) ?? n(p.initialStop),
        remainingFraction: clamp01(p.remainingFraction ?? 1),
        realizedPnlEur: n(p.realizedPnlEur) ?? 0,
        maxFavorablePrice: n(p.maxFavorablePrice) ?? n(p.entry),
        minAdversePrice: n(p.minAdversePrice) ?? n(p.entry),
        partialTaken: Boolean(p.partialTaken),
        targetZoneReached: Boolean(p.targetZoneReached),
        decisionHistory: Array.isArray(p.decisionHistory) ? p.decisionHistory : [],
        legs: Array.isArray(p.legs) ? p.legs : []
      }))
    : [];
  state.lastEntryEligibleByMarket =
    state.lastEntryEligibleByMarket && typeof state.lastEntryEligibleByMarket === "object"
      ? state.lastEntryEligibleByMarket
      : {};
  state.stats = { ...base.stats, ...(state.stats || {}) };
  return state;
}

export function processPortfolioShadowState(inputState, signalsDoc, snapshot) {
  const state = migrateState(inputState);
  if (!state.startedAtSnapshot) state.startedAtSnapshot = snapshot?.collectedAt ?? null;
  if (!snapshot?.collectedAt || !signalsDoc) {
    throw new Error("snapshot/signals missing");
  }
  if (signalsDoc.snapshotCollectedAt !== snapshot.collectedAt) {
    throw new Error("signals snapshot mismatch");
  }
  if (state.lastProcessedSnapshot === snapshot.collectedAt) {
    return {
      state,
      closedTrades: [],
      events: [],
      skippedEntries: [],
      openedPositions: [],
      monitoringGaps: 0
    };
  }

  const signals = Array.isArray(signalsDoc.signals) ? signalsDoc.signals : [];
  const signalByMarket = new Map(signals.map((s) => [s.market, s]));
  const events = [];
  const closedTrades = [];
  const stillOpen = [];
  let monitoringGaps = 0;

  for (const position of state.openPositions) {
    const barResult = evaluateBars(state, position, snapshot);
    events.push(...barResult.events);
    if (barResult.monitoringGap) {
      monitoringGaps += 1;
      state.stats.monitoringGaps += 1;
    }
    if (barResult.closedTrade) {
      closedTrades.push(barResult.closedTrade);
      continue;
    }
    if (!barResult.position) continue;

    const managed = applyManagementDecision(
      state,
      barResult.position,
      signalByMarket.get(position.market) || null,
      snapshot
    );
    events.push(...managed.events);
    if (managed.closedTrade) closedTrades.push(managed.closedTrade);
    if (managed.position) stillOpen.push(managed.position);
  }
  state.openPositions = stillOpen;

  const currentEligible = {};
  const candidates = signals
    .filter((s) => {
      const eligible = validStrictBuySignal(s);
      currentEligible[s.market] = eligible;
      return eligible && !state.lastEntryEligibleByMarket[s.market];
    })
    .sort((a, b) =>
      (b.tradeGrade === "A" ? 1 : 0) - (a.tradeGrade === "A" ? 1 : 0) ||
      (n(b.score) || 0) - (n(a.score) || 0)
    );

  for (const s of signals) {
    if (!(s.market in currentEligible)) currentEligible[s.market] = validStrictBuySignal(s);
  }

  const skippedEntries = [];
  const openedPositions = [];

  for (const signal of candidates) {
    if (state.openPositions.some((p) => p.market === signal.market)) continue;

    if (state.openPositions.length >= PORTFOLIO_SHADOW_POLICY.maxPositions) {
      state.stats.entriesSkippedCapacity += 1;
      skippedEntries.push({
        at: snapshot.collectedAt,
        market: signal.market,
        reason: "max portfolio positions reached"
      });
      continue;
    }

    const position = makePosition(state, signal, snapshot);
    if (!position) {
      state.stats.entriesSkippedRisk += 1;
      skippedEntries.push({
        at: snapshot.collectedAt,
        market: signal.market,
        reason: "portfolio risk/capital budget unavailable"
      });
      continue;
    }

    state.openPositions.push(position);
    state.stats.entriesOpened += 1;
    openedPositions.push(position.market);
    events.push({
      type: "POSITION_OPENED",
      market: position.market,
      at: snapshot.collectedAt,
      plannedRiskEur: position.plannedRiskEur,
      amountEur: position.amountEur,
      family: position.family,
      tradeGrade: position.tradeGrade,
      thesisScore: position.entryContext.score,
      btcRegime: position.entryContext.btcRegime
    });
  }

  state.lastEntryEligibleByMarket = currentEligible;
  state.lastProcessedSnapshot = snapshot.collectedAt;

  return {
    state,
    closedTrades,
    events,
    skippedEntries,
    openedPositions,
    monitoringGaps
  };
}

export function portfolioSnapshot(state) {
  return {
    openPositions: state.openPositions.length,
    allocatedEur: openAllocatedEur(state.openPositions),
    estimatedRiskEur: combinedRiskEur(state.openPositions),
    realizedNetPnlEur: state.realizedNetPnlEur,
    realizedEquityEur: state.realizedEquityEur,
    maxRealizedDrawdownEur: state.maxRealizedDrawdownEur,
    maxRealizedDrawdownPct: state.maxRealizedDrawdownPct
  };
}
