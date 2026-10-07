import { closed5mBars } from "./paper-trader.js";

export const EXIT_SHADOW_MIN_CLOSED_TRADES = 30;

export const EXIT_SHADOW_POLICIES = [
  {
    id: "full-runner-trail-1r",
    label: "100% runner after target, 1R trailing stop",
    takeProfitFractionAtTarget: 0,
    trailRiskMultiple: 1
  },
  {
    id: "full-runner-trail-1_5r",
    label: "100% runner after target, 1.5R trailing stop",
    takeProfitFractionAtTarget: 0,
    trailRiskMultiple: 1.5
  },
  {
    id: "half-target-runner-trail-1r",
    label: "50% at target, 50% runner with 1R trailing stop",
    takeProfitFractionAtTarget: 0.5,
    trailRiskMultiple: 1
  }
];

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

export function newExitShadowState(startedAtSnapshot = null) {
  return {
    version: "1.0",
    model: "prospective-exit-shadow-v1",
    mode: "shadow",
    affectsLiveTrading: false,
    affectsFrozenProtocol: false,
    startedAtSnapshot,
    lastProcessedSnapshot: null,
    seenStrictPositionIds: [],
    openPositions: []
  };
}

function migrateState(input) {
  const state = {
    ...newExitShadowState(),
    ...(input || {})
  };
  state.version = "1.0";
  state.model = "prospective-exit-shadow-v1";
  state.mode = "shadow";
  state.affectsLiveTrading = false;
  state.affectsFrozenProtocol = false;
  state.seenStrictPositionIds = Array.isArray(state.seenStrictPositionIds)
    ? state.seenStrictPositionIds
    : [];
  state.openPositions = Array.isArray(state.openPositions)
    ? state.openPositions.map((p) => ({
        ...p,
        remainingFraction: clamp01(p.remainingFraction ?? 1),
        realizedPnlEur: n(p.realizedPnlEur) ?? 0,
        currentStop: n(p.currentStop) ?? n(p.originalStop),
        peakAfterTarget: n(p.peakAfterTarget) ?? n(p.originalTarget),
        targetReached: Boolean(p.targetReached),
        legs: Array.isArray(p.legs) ? p.legs : []
      }))
    : [];
  return state;
}

function costAdjustedBreakeven(entry, roundTripCostPct) {
  const e = n(entry);
  const c = n(roundTripCostPct);
  if (!(e > 0) || !(c >= 0)) return null;
  return e * (1 + c / 100);
}

function legNetPnlEur(position, fraction, exitPrice) {
  const f = clamp01(fraction);
  const entry = n(position.entry);
  const exit = n(exitPrice);
  const costs = n(position.roundTripCostPct);
  const amount = n(position.amountEur);
  if (!(f > 0 && entry > 0 && exit > 0 && costs >= 0 && amount > 0)) return 0;
  const grossPct = 100 * (exit - entry) / entry;
  const netPct = grossPct - costs;
  return amount * f * netPct / 100;
}

function makeShadowPosition(strictPosition, policy) {
  const entry = n(strictPosition.entry);
  const stop = n(strictPosition.stop);
  const target = n(strictPosition.target);
  const amountEur = n(strictPosition.amountEur);
  const risk = n(strictPosition.plannedRiskEur);
  const costs = n(strictPosition.roundTripCostPct);
  if (!(entry > 0 && stop > 0 && stop < entry && target > entry && amountEur > 0 && risk > 0 && costs >= 0)) {
    return null;
  }

  return {
    id: `${strictPosition.id}|exit-shadow|${policy.id}`,
    strictPositionId: strictPosition.id,
    policyId: policy.id,
    market: strictPosition.market,
    family: strictPosition.family,
    tradeGrade: strictPosition.tradeGrade,
    openedAt: strictPosition.openedAt,
    signalSnapshotAt: strictPosition.signalSnapshotAt ?? strictPosition.openedAt ?? null,
    entry,
    originalStop: stop,
    originalTarget: target,
    amountEur,
    quantity: n(strictPosition.quantity),
    plannedRiskEur: risk,
    roundTripCostPct: costs,
    structuralRiskAbs: entry - stop,
    btcRegimeAtEntry: strictPosition.btcRegimeAtEntry ?? null,
    lastEvaluatedCandleOpenTime: strictPosition.lastEvaluatedCandleOpenTime ?? null,
    currentStop: stop,
    targetReached: false,
    targetReachedAt: null,
    peakAfterTarget: entry,
    remainingFraction: 1,
    realizedPnlEur: 0,
    legs: [],
    evaluatedBars: 0
  };
}

function closeShadowPosition(position, bar, exitPrice, exitReason, snapshotCollectedAt, policy, extra = {}) {
  const remainingFraction = clamp01(position.remainingFraction);
  const finalLegPnl = legNetPnlEur(position, remainingFraction, exitPrice);
  const totalPnl = (n(position.realizedPnlEur) ?? 0) + finalLegPnl;
  const finalLeg = remainingFraction > 0
    ? {
        type: "FINAL_EXIT",
        fraction: remainingFraction,
        price: exitPrice,
        netPnlEur: finalLegPnl,
        at: new Date(bar.ts + 5 * 60 * 1000).toISOString(),
        reason: exitReason
      }
    : null;
  const legs = finalLeg ? [...position.legs, finalLeg] : [...position.legs];

  return {
    id: position.id,
    strictPositionId: position.strictPositionId,
    policyId: position.policyId,
    policyLabel: policy.label,
    market: position.market,
    family: position.family,
    tradeGrade: position.tradeGrade,
    openedAt: position.openedAt,
    signalSnapshotAt: position.signalSnapshotAt,
    closedAt: new Date(bar.ts + 5 * 60 * 1000).toISOString(),
    processedAtSnapshot: snapshotCollectedAt,
    entry: position.entry,
    originalStop: position.originalStop,
    originalTarget: position.originalTarget,
    finalExitPrice: exitPrice,
    exitReason,
    amountEur: position.amountEur,
    plannedRiskEur: position.plannedRiskEur,
    roundTripCostPct: position.roundTripCostPct,
    targetReached: position.targetReached,
    targetReachedAt: position.targetReachedAt,
    peakAfterTarget: position.peakAfterTarget,
    netPnlEur: totalPnl,
    netR: totalPnl / position.plannedRiskEur,
    legs,
    evaluatedBars: position.evaluatedBars,
    barCloseTrailing: true,
    ambiguityPolicy: "If original stop and target are both touched in one 5m candle before target activation, stop is assumed first. Trailing changes only after a completed 5m candle and uses the highest confirmed 5m close.",
    ...extra
  };
}

function processPosition(position, policy, snapshot) {
  const asOfMs = Date.parse(snapshot?.collectedAt);
  const raw = snapshot?.deep?.[position.market]?.candles?.["5m"];
  if (!Number.isFinite(asOfMs) || !raw) {
    return { position, closedTrade: null, event: null, monitoringGap: true };
  }

  const bars = closed5mBars(raw, asOfMs)
    .filter((b) => b.ts > (position.lastEvaluatedCandleOpenTime ?? -Infinity));

  for (const bar of bars) {
    const activeStop = n(position.currentStop) ?? position.originalStop;
    const hitStop = bar.low <= activeStop;
    const hitTarget = !position.targetReached && bar.high >= position.originalTarget;

    // Conservative ordering while the original stop and target coexist.
    if (hitStop) {
      const reason = position.targetReached ? "RUNNER_STOP" : "STOP_BEFORE_TARGET";
      return {
        position: null,
        closedTrade: closeShadowPosition(
          position,
          bar,
          activeStop,
          reason,
          snapshot.collectedAt,
          policy,
          { ambiguousTargetStopSameCandle: Boolean(hitTarget) }
        ),
        event: { type: reason, market: position.market, policyId: policy.id },
        monitoringGap: false
      };
    }

    if (hitTarget) {
      position.targetReached = true;
      position.targetReachedAt = new Date(bar.ts + 5 * 60 * 1000).toISOString();
      position.peakAfterTarget = Math.max(position.entry, bar.close);

      const takeFraction = clamp01(policy.takeProfitFractionAtTarget);
      if (takeFraction > 0) {
        const pnl = legNetPnlEur(position, takeFraction, position.originalTarget);
        position.realizedPnlEur += pnl;
        position.remainingFraction = clamp01(position.remainingFraction - takeFraction);
        position.legs.push({
          type: "TARGET_PARTIAL",
          fraction: takeFraction,
          price: position.originalTarget,
          netPnlEur: pnl,
          at: position.targetReachedAt
        });
      }

      // The protective change becomes effective only for the next fully
      // evaluated 5m candle. This makes the shadow rule reproducible without
      // inventing intrabar ordering.
      const breakeven = costAdjustedBreakeven(position.entry, position.roundTripCostPct);
      if (breakeven !== null) {
        position.currentStop = Math.max(position.currentStop, breakeven);
      }
    }

    if (position.targetReached) {
      position.peakAfterTarget = Math.max(position.peakAfterTarget, bar.close);
      const trailStop = position.peakAfterTarget - policy.trailRiskMultiple * position.structuralRiskAbs;
      const breakeven = costAdjustedBreakeven(position.entry, position.roundTripCostPct);
      position.currentStop = Math.max(
        position.currentStop,
        breakeven ?? position.currentStop,
        trailStop
      );
    }

    position.lastEvaluatedCandleOpenTime = bar.ts;
    position.evaluatedBars += 1;
  }

  return { position, closedTrade: null, event: null, monitoringGap: false };
}

export function processExitShadowState(inputState, strictOpenPositions, snapshot) {
  const state = migrateState(inputState);
  if (!state.startedAtSnapshot) state.startedAtSnapshot = snapshot?.collectedAt ?? null;
  if (state.lastProcessedSnapshot === snapshot?.collectedAt) {
    return { state, closedTrades: [], events: [], monitoringGaps: 0, enrolledStrictPositions: [] };
  }

  const policyById = new Map(EXIT_SHADOW_POLICIES.map((p) => [p.id, p]));
  const closedTrades = [];
  const events = [];
  const stillOpen = [];
  let monitoringGaps = 0;

  for (const position of state.openPositions) {
    const policy = policyById.get(position.policyId);
    if (!policy) continue;
    const result = processPosition(position, policy, snapshot);
    if (result.monitoringGap) monitoringGaps += 1;
    if (result.closedTrade) closedTrades.push(result.closedTrade);
    if (result.event) events.push({ ...result.event, at: snapshot.collectedAt });
    if (result.position) stillOpen.push(result.position);
  }
  state.openPositions = stillOpen;

  const seen = new Set(state.seenStrictPositionIds);
  const enrolledStrictPositions = [];
  for (const strictPosition of strictOpenPositions || []) {
    // Strict direct entries are timestamped with the snapshot that created them.
    // Enrolling only at inception avoids pretending we observed earlier bars.
    if (strictPosition?.openedAt !== snapshot?.collectedAt) continue;
    if (!strictPosition?.id || seen.has(strictPosition.id)) continue;

    const created = EXIT_SHADOW_POLICIES
      .map((policy) => makeShadowPosition(strictPosition, policy))
      .filter(Boolean);

    if (created.length === EXIT_SHADOW_POLICIES.length) {
      state.openPositions.push(...created);
      state.seenStrictPositionIds.push(strictPosition.id);
      seen.add(strictPosition.id);
      enrolledStrictPositions.push(strictPosition.id);
      events.push({
        type: "STRICT_POSITION_ENROLLED",
        strictPositionId: strictPosition.id,
        market: strictPosition.market,
        at: snapshot.collectedAt,
        policies: EXIT_SHADOW_POLICIES.map((p) => p.id)
      });
    }
  }

  state.seenStrictPositionIds = state.seenStrictPositionIds.slice(-1000);
  state.lastProcessedSnapshot = snapshot?.collectedAt ?? null;

  return {
    state,
    closedTrades,
    events,
    monitoringGaps,
    enrolledStrictPositions
  };
}
