const CFG = {
  startingCapitalEur: 300,
  maxPositions: 2,
  maxCombinedRiskEur: 3,
  candleMs: 5 * 60 * 1000
};

const STRICT_POLICY = {
  id: "strict",
  minDirectNetRR: 1.5,
  enableRetest: false,
  retestTargetNetRR: 1.5,
  retestMaxAtr15: 0.75,
  pendingBars: 6
};

const OPPORTUNISTIC_POLICY = {
  id: "opportunistic",
  minDirectNetRR: 1.25,
  enableRetest: true,
  retestTargetNetRR: 1.5,
  retestMaxAtr15: 0.75,
  pendingBars: 6
};

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function closed5mBars(raw, asOfMs) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    .map((r) => ({
      ts: n(r?.[0]), open: n(r?.[1]), high: n(r?.[2]),
      low: n(r?.[3]), close: n(r?.[4]), volume: n(r?.[5])
    }))
    .filter((b) =>
      b.ts !== null && b.open !== null && b.high !== null &&
      b.low !== null && b.close !== null && b.ts + CFG.candleMs <= asOfMs
    )
    .filter((b) => {
      if (seen.has(b.ts)) return false;
      seen.add(b.ts);
      return true;
    })
    .sort((a, b) => a.ts - b.ts);
}

function newState(policy = STRICT_POLICY) {
  return {
    version: "2.0",
    model: "paper-trading-v2",
    policyId: policy.id,
    startingCapitalEur: CFG.startingCapitalEur,
    realizedNetPnlEur: 0,
    realizedEquityEur: CFG.startingCapitalEur,
    peakRealizedEquityEur: CFG.startingCapitalEur,
    maxRealizedDrawdownEur: 0,
    maxRealizedDrawdownPct: 0,
    openPositions: [],
    pendingEntries: [],
    lastDirectCandidateByMarket: {},
    lastRetestCandidateByMarket: {},
    lastProcessedSnapshot: null,
    stats: {
      closedTrades: 0,
      wins: 0,
      losses: 0,
      ambiguousExits: 0,
      skippedSignals: 0,
      monitoringGaps: 0,
      pendingCreated: 0,
      pendingFilled: 0,
      pendingExpired: 0,
      pendingCancelled: 0
    }
  };
}

function migrateState(inputState, policy) {
  if (!inputState) return newState(policy);
  const state = JSON.parse(JSON.stringify(inputState));
  state.version = "2.0";
  state.model = "paper-trading-v2";
  state.policyId = policy.id;
  state.openPositions ||= [];
  state.openPositions = state.openPositions.map((p) => ({
    ...p,
    signalSnapshotAt: p.signalSnapshotAt ?? p.openedAt ?? null,
    maxFavorablePrice: n(p.maxFavorablePrice) ?? n(p.entry),
    minAdversePrice: n(p.minAdversePrice) ?? n(p.entry),
    evaluatedFullBars: Number.isFinite(Number(p.evaluatedFullBars)) ? Number(p.evaluatedFullBars) : 0
  }));
  state.pendingEntries ||= [];
  state.lastDirectCandidateByMarket ||= Object.fromEntries(
    Object.entries(state.lastActionByMarket || {}).map(([m, a]) => [m, a === "BUY"])
  );
  state.lastRetestCandidateByMarket ||= {};
  state.stats ||= {};
  for (const [k, v] of Object.entries(newState(policy).stats)) {
    if (state.stats[k] === undefined) state.stats[k] = v;
  }
  return state;
}

function plannedRisk(openPositions) {
  return openPositions.reduce((s, p) => s + (n(p.plannedRiskEur) || 0), 0);
}

function allocated(openPositions) {
  return openPositions.reduce((s, p) => s + (n(p.amountEur) || 0), 0);
}

function dataQualityOk(signal) {
  const q = Object.values(signal?.dataQuality || {});
  return q.length > 0 && q.every((x) => x?.ok === true);
}

function validStructure(signal) {
  const entry = n(signal?.entry);
  const stop = n(signal?.stop);
  const target = n(signal?.target);
  const costs = n(signal?.roundTripCostPct);
  const riskBudget = n(signal?.suggestedRiskEur);
  return Boolean(
    signal?.trigger &&
    (signal?.tradeGrade === "A" || signal?.tradeGrade === "B") &&
    dataQualityOk(signal) &&
    entry > 0 && stop > 0 && stop < entry &&
    target > entry && costs !== null && costs >= 0 &&
    riskBudget > 0
  );
}

function netRiskPct(entry, stop, costs) {
  return 100 * (entry - stop) / entry + costs;
}

function amountForRisk(state, entry, stop, costs, riskBudget, preferredAmount = null) {
  const riskPct = netRiskPct(entry, stop, costs);
  if (!(riskPct > 0 && riskBudget > 0)) return null;
  const rawAmount = preferredAmount > 0 ? preferredAmount : riskBudget / (riskPct / 100);
  const availableCapital = Math.max(0, state.realizedEquityEur - allocated(state.openPositions));
  const remainingRisk = Math.max(0, CFG.maxCombinedRiskEur - plannedRisk(state.openPositions));
  const amount = Math.min(rawAmount, availableCapital, remainingRisk / (riskPct / 100));
  if (!(amount > 0)) return null;
  return { amount, risk: amount * riskPct / 100, riskPct };
}

function requiredEntryForNetRR(stop, target, costs, desiredRR) {
  if (!(stop > 0 && target > stop && costs >= 0 && desiredRR > 0)) return null;
  const entry = (100 * target + 100 * desiredRR * stop) /
    ((1 + desiredRR) * (100 + costs));
  return Number.isFinite(entry) ? entry : null;
}

function closePosition(state, p, bar, reason, ambiguous, snapshotCollectedAt, extra = {}) {
  const grossPct = ((bar.exitPrice - p.entry) / p.entry) * 100;
  const netPct = grossPct - p.roundTripCostPct;
  const pnlEur = p.amountEur * netPct / 100;

  // Conservative excursion accounting with 5m candles:
  // include completed non-exit bars in full; on the exit bar include only the
  // known exit level, because the order of that candle's high/low is unknown.
  let maxFavorablePrice = n(p.maxFavorablePrice) ?? p.entry;
  let minAdversePrice = n(p.minAdversePrice) ?? p.entry;
  if (reason === "TARGET") maxFavorablePrice = Math.max(maxFavorablePrice, bar.exitPrice);
  if (reason === "STOP") minAdversePrice = Math.min(minAdversePrice, bar.exitPrice);
  const mfePctGross = 100 * (maxFavorablePrice - p.entry) / p.entry;
  const maePctGross = 100 * (p.entry - minAdversePrice) / p.entry;
  const structuralRiskPct = 100 * (p.entry - p.stop) / p.entry;
  const mfeStructuralR = structuralRiskPct > 0 ? mfePctGross / structuralRiskPct : null;
  const maeStructuralR = structuralRiskPct > 0 ? maePctGross / structuralRiskPct : null;
  state.realizedNetPnlEur += pnlEur;
  state.realizedEquityEur = state.startingCapitalEur + state.realizedNetPnlEur;
  state.peakRealizedEquityEur = Math.max(state.peakRealizedEquityEur, state.realizedEquityEur);
  const dd = state.peakRealizedEquityEur - state.realizedEquityEur;
  const ddPct = state.peakRealizedEquityEur > 0 ? 100 * dd / state.peakRealizedEquityEur : 0;
  state.maxRealizedDrawdownEur = Math.max(state.maxRealizedDrawdownEur, dd);
  state.maxRealizedDrawdownPct = Math.max(state.maxRealizedDrawdownPct, ddPct);
  state.stats.closedTrades += 1;
  if (pnlEur > 0) state.stats.wins += 1; else state.stats.losses += 1;
  if (ambiguous) state.stats.ambiguousExits += 1;

  return {
    id: p.id,
    cohort: state.policyId,
    market: p.market,
    family: p.family,
    tradeGrade: p.tradeGrade,
    entryMode: p.entryMode,
    openedAt: p.openedAt,
    signalSnapshotAt: p.signalSnapshotAt ?? p.openedAt ?? null,
    closedAt: new Date(bar.ts + CFG.candleMs).toISOString(),
    processedAtSnapshot: snapshotCollectedAt,
    entry: p.entry,
    stop: p.stop,
    target: p.target,
    exitPrice: bar.exitPrice,
    exitReason: reason,
    ambiguousSameCandle: ambiguous,
    amountEur: p.amountEur,
    quantity: p.quantity,
    plannedRiskEur: p.plannedRiskEur,
    roundTripCostPct: p.roundTripCostPct,
    grossReturnPct: grossPct,
    netReturnPct: netPct,
    netPnlEur: pnlEur,
    initialNetRR: p.initialNetRR,
    btcRegimeAtEntry: p.btcRegimeAtEntry,
    maxFavorablePrice,
    minAdversePrice,
    mfePctGross,
    maePctGross,
    mfeStructuralR,
    maeStructuralR,
    evaluatedFullBars: p.evaluatedFullBars ?? 0,
    excursionMethod: "conservative 5m: full non-exit bars; exit level only on exit candle",
    ...extra
  };
}

function makePosition(state, signal, entry, openedAt, lastClosedTs, entryMode, policy, signalSnapshotAt = openedAt) {
  const stop = n(signal.stop);
  const target = n(signal.target);
  const costs = n(signal.roundTripCostPct);
  const riskBudget = n(signal.suggestedRiskEur);
  const preferred = entryMode === "signal" ? n(signal.suggestedAmountEur) : null;
  const sizing = amountForRisk(state, entry, stop, costs, riskBudget, preferred);
  if (!sizing) return null;

  const grossRewardPct = 100 * (target - entry) / entry;
  const initialNetRR = (grossRewardPct - costs) / sizing.riskPct;
  return {
    id: [policy.id, signal.market, openedAt].join("|"),
    cohort: policy.id,
    market: signal.market,
    family: signal.family,
    tradeGrade: signal.tradeGrade,
    score: signal.score,
    openedAt,
    signalSnapshotAt,
    entryMode,
    entry,
    stop,
    target,
    amountEur: sizing.amount,
    quantity: sizing.amount / entry,
    plannedRiskEur: sizing.risk,
    roundTripCostPct: costs,
    initialNetRR,
    btcRegimeAtEntry: signal.btcRegime ?? null,
    maxFavorablePrice: entry,
    minAdversePrice: entry,
    evaluatedFullBars: 0,
    lastEvaluatedCandleOpenTime: lastClosedTs
  };
}

function retestCandidate(signal, policy) {
  if (!policy.enableRetest || !validStructure(signal)) return null;
  if (n(signal.netRR) >= policy.minDirectNetRR) return null;

  const currentEntry = n(signal.entry);
  const stop = n(signal.stop);
  const target = n(signal.target);
  const costs = n(signal.roundTripCostPct);
  const atr15 = n(signal?.metrics?.["15m"]?.atr);
  if (!(atr15 > 0)) return null;

  const limitEntry = requiredEntryForNetRR(stop, target, costs, policy.retestTargetNetRR);
  if (!(limitEntry > stop && limitEntry < currentEntry && limitEntry < target)) return null;
  if ((currentEntry - limitEntry) > policy.retestMaxAtr15 * atr15) return null;

  return { limitEntry, atr15 };
}

function processExits(state, snapshot, asOfMs, closedTrades) {
  const stillOpen = [];
  for (const p of state.openPositions) {
    const raw = snapshot?.deep?.[p.market]?.candles?.["5m"];
    if (!raw) {
      state.stats.monitoringGaps += 1;
      stillOpen.push(p);
      continue;
    }
    const bars = closed5mBars(raw, asOfMs)
      .filter((b) => b.ts > (p.lastEvaluatedCandleOpenTime ?? -Infinity));
    let closed = false;
    for (const b of bars) {
      const hitStop = b.low <= p.stop;
      const hitTarget = b.high >= p.target;
      if (!hitStop && !hitTarget) {
        p.maxFavorablePrice = Math.max(n(p.maxFavorablePrice) ?? p.entry, b.high);
        p.minAdversePrice = Math.min(n(p.minAdversePrice) ?? p.entry, b.low);
        p.evaluatedFullBars = (p.evaluatedFullBars ?? 0) + 1;
        p.lastEvaluatedCandleOpenTime = b.ts;
        continue;
      }
      const ambiguous = hitStop && hitTarget;
      const reason = hitStop ? "STOP" : "TARGET";
      const exitPrice = hitStop ? p.stop : p.target;
      closedTrades.push(closePosition(state, p, { ...b, exitPrice }, reason, ambiguous, snapshot.collectedAt));
      closed = true;
      break;
    }
    if (!closed) stillOpen.push(p);
  }
  state.openPositions = stillOpen;
}

function processPending(state, signalsDoc, snapshot, asOfMs, closedTrades, skippedSignals, events, policy) {
  if (!policy.enableRetest) {
    state.pendingEntries = [];
    return;
  }

  const signalMap = Object.fromEntries((signalsDoc?.signals || []).map((s) => [s.market, s]));
  const remaining = [];

  for (const p of state.pendingEntries) {
    const raw = snapshot?.deep?.[p.market]?.candles?.["5m"];
    if (!raw) {
      state.stats.monitoringGaps += 1;
      remaining.push(p);
      continue;
    }

    const bars = closed5mBars(raw, asOfMs)
      .filter((b) => b.ts > (p.lastEvaluatedCandleOpenTime ?? -Infinity));

    let resolved = false;
    for (const b of bars) {
      if (b.ts > p.expiresAtMs) break;

      if (b.high >= p.target && b.low > p.limitEntry) {
        state.stats.pendingCancelled += 1;
        events.push({
          type: "RETEST_CANCELLED",
          cohort: policy.id,
          market: p.market,
          at: new Date(b.ts + CFG.candleMs).toISOString(),
          reason: "target reached before retest"
        });
        resolved = true;
        break;
      }

      if (b.low <= p.limitEntry) {
        if (state.openPositions.length >= CFG.maxPositions || state.openPositions.some((x) => x.market === p.market)) {
          state.stats.skippedSignals += 1;
          skippedSignals.push({
            snapshotCollectedAt: snapshot.collectedAt,
            cohort: policy.id,
            market: p.market,
            family: p.family,
            tradeGrade: p.tradeGrade,
            reasons: ["retest filled but portfolio capacity unavailable"]
          });
          resolved = true;
          break;
        }

        const signal = signalMap[p.market] || p.signalSnapshot;
        const position = makePosition(
          state,
          { ...signal, stop: p.stop, target: p.target, roundTripCostPct: p.roundTripCostPct, suggestedRiskEur: p.riskBudgetEur },
          p.limitEntry,
          new Date(b.ts + CFG.candleMs).toISOString(),
          b.ts,
          "retest-limit",
          policy,
          p.createdAt
        );

        if (!position) {
          state.stats.skippedSignals += 1;
          skippedSignals.push({
            snapshotCollectedAt: snapshot.collectedAt,
            cohort: policy.id,
            market: p.market,
            family: p.family,
            tradeGrade: p.tradeGrade,
            reasons: ["retest filled but sizing failed"]
          });
          resolved = true;
          break;
        }

        state.stats.pendingFilled += 1;
        events.push({
          type: "RETEST_FILLED",
          cohort: policy.id,
          market: p.market,
          at: position.openedAt,
          entry: p.limitEntry,
          targetNetRR: policy.retestTargetNetRR
        });

        if (b.low <= p.stop) {
          closedTrades.push(closePosition(
            state,
            position,
            { ...b, exitPrice: p.stop },
            "STOP",
            true,
            snapshot.collectedAt,
            { ambiguousEntryStopSameCandle: true }
          ));
        } else {
          state.openPositions.push(position);
        }
        resolved = true;
        break;
      }

      p.lastEvaluatedCandleOpenTime = b.ts;
    }

    if (resolved) continue;

    if (asOfMs >= p.expiresAtMs) {
      state.stats.pendingExpired += 1;
      events.push({
        type: "RETEST_EXPIRED",
        cohort: policy.id,
        market: p.market,
        at: snapshot.collectedAt
      });
      continue;
    }

    remaining.push(p);
  }

  state.pendingEntries = remaining;
}

function processPaperState(inputState, signalsDoc, snapshot, policy = STRICT_POLICY) {
  const state = migrateState(inputState, policy);
  const closedTrades = [];
  const skippedSignals = [];
  const events = [];
  const asOfMs = Date.parse(snapshot?.collectedAt);
  if (!Number.isFinite(asOfMs)) throw new Error("Invalid snapshot collectedAt");

  processExits(state, snapshot, asOfMs, closedTrades);
  processPending(state, signalsDoc, snapshot, asOfMs, closedTrades, skippedSignals, events, policy);

  const currentSignals = Array.isArray(signalsDoc?.signals) ? signalsDoc.signals : [];
  const currentDirect = {};
  const currentRetest = {};

  for (const s of currentSignals) {
    const directEligible = policy.id === "strict"
      ? s.action === "BUY"
      : validStructure(s) && n(s.netRR) >= policy.minDirectNetRR;
    const retest = retestCandidate(s, policy);

    currentDirect[s.market] = directEligible;
    currentRetest[s.market] = Boolean(retest);

    if (directEligible && !state.lastDirectCandidateByMarket[s.market]) {
      const before = state.pendingEntries.length;
      state.pendingEntries = state.pendingEntries.filter((p) => p.market !== s.market);
      if (state.pendingEntries.length < before) {
        state.stats.pendingCancelled += 1;
        events.push({
          type: "RETEST_CANCELLED",
          cohort: policy.id,
          market: s.market,
          at: snapshot.collectedAt,
          reason: "direct entry became valid"
        });
      }

      const reasons = [];
      if (state.openPositions.length >= CFG.maxPositions) reasons.push("max positions reached");
      if (state.openPositions.some((p) => p.market === s.market)) reasons.push("market already open");

      const entry = n(s.entry);
      const closed = closed5mBars(snapshot?.deep?.[s.market]?.candles?.["5m"], asOfMs);
      const lastClosedTs = closed.length ? closed[closed.length - 1].ts : null;
      const position = reasons.length ? null : makePosition(
        state, s, entry, snapshot.collectedAt, lastClosedTs, "signal", policy, snapshot.collectedAt
      );
      if (!position && reasons.length === 0) reasons.push("invalid sizing or structure");

      if (reasons.length) {
        state.stats.skippedSignals += 1;
        skippedSignals.push({
          snapshotCollectedAt: snapshot.collectedAt,
          cohort: policy.id,
          market: s.market,
          family: s.family,
          tradeGrade: s.tradeGrade,
          reasons
        });
      } else {
        state.openPositions.push(position);
      }
    }

    if (
      retest &&
      !directEligible &&
      !state.lastRetestCandidateByMarket[s.market] &&
      !state.openPositions.some((p) => p.market === s.market) &&
      !state.pendingEntries.some((p) => p.market === s.market)
    ) {
      const closed = closed5mBars(snapshot?.deep?.[s.market]?.candles?.["5m"], asOfMs);
      const lastClosedTs = closed.length ? closed[closed.length - 1].ts : null;
      const expiresAtMs = asOfMs + policy.pendingBars * CFG.candleMs;
      state.pendingEntries.push({
        id: [policy.id, s.market, snapshot.collectedAt, "retest"].join("|"),
        cohort: policy.id,
        market: s.market,
        family: s.family,
        tradeGrade: s.tradeGrade,
        score: s.score,
        createdAt: snapshot.collectedAt,
        expiresAtMs,
        limitEntry: retest.limitEntry,
        originalEntry: n(s.entry),
        stop: n(s.stop),
        target: n(s.target),
        roundTripCostPct: n(s.roundTripCostPct),
        riskBudgetEur: n(s.suggestedRiskEur),
        initialSignalRR: n(s.netRR),
        desiredNetRR: policy.retestTargetNetRR,
        btcRegimeAtSignal: s.btcRegime ?? signalsDoc.btcRegime ?? null,
        lastEvaluatedCandleOpenTime: lastClosedTs,
        signalSnapshot: {
          market: s.market,
          family: s.family,
          tradeGrade: s.tradeGrade,
          score: s.score,
          btcRegime: s.btcRegime ?? signalsDoc.btcRegime ?? null,
          suggestedRiskEur: n(s.suggestedRiskEur)
        }
      });
      state.stats.pendingCreated += 1;
      events.push({
        type: "RETEST_CREATED",
        cohort: policy.id,
        market: s.market,
        at: snapshot.collectedAt,
        originalEntry: n(s.entry),
        limitEntry: retest.limitEntry,
        stop: n(s.stop),
        target: n(s.target),
        desiredNetRR: policy.retestTargetNetRR
      });
    }
  }

  state.lastDirectCandidateByMarket = currentDirect;
  state.lastRetestCandidateByMarket = currentRetest;
  state.lastProcessedSnapshot = snapshot.collectedAt;

  return { state, closedTrades, skippedSignals, events };
}

export {
  CFG,
  STRICT_POLICY,
  OPPORTUNISTIC_POLICY,
  n,
  closed5mBars,
  newState,
  requiredEntryForNetRR,
  retestCandidate,
  processPaperState
};
