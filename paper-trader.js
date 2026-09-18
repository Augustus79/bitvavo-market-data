const CFG = {
  startingCapitalEur: 300,
  maxPositions: 2,
  maxCombinedRiskEur: 3,
  candleMs: 5 * 60 * 1000
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

function newState() {
  return {
    version: "1.0",
    model: "paper-trading-v1",
    startingCapitalEur: CFG.startingCapitalEur,
    realizedNetPnlEur: 0,
    realizedEquityEur: CFG.startingCapitalEur,
    peakRealizedEquityEur: CFG.startingCapitalEur,
    maxRealizedDrawdownEur: 0,
    maxRealizedDrawdownPct: 0,
    openPositions: [],
    lastActionByMarket: {},
    lastProcessedSnapshot: null,
    stats: {
      closedTrades: 0,
      wins: 0,
      losses: 0,
      ambiguousExits: 0,
      skippedSignals: 0,
      monitoringGaps: 0
    }
  };
}

function plannedRisk(openPositions) {
  return openPositions.reduce((s, p) => s + (n(p.plannedRiskEur) || 0), 0);
}

function allocated(openPositions) {
  return openPositions.reduce((s, p) => s + (n(p.amountEur) || 0), 0);
}

function closePosition(state, p, bar, reason, ambiguous, snapshotCollectedAt) {
  const grossPct = ((bar.exitPrice - p.entry) / p.entry) * 100;
  const netPct = grossPct - p.roundTripCostPct;
  const pnlEur = p.amountEur * netPct / 100;
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
    market: p.market,
    family: p.family,
    tradeGrade: p.tradeGrade,
    openedAt: p.openedAt,
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
    btcRegimeAtEntry: p.btcRegimeAtEntry
  };
}

function processPaperState(inputState, signalsDoc, snapshot) {
  const state = inputState ? JSON.parse(JSON.stringify(inputState)) : newState();
  const closedTrades = [];
  const skippedSignals = [];
  const asOfMs = Date.parse(snapshot?.collectedAt);
  if (!Number.isFinite(asOfMs)) throw new Error("Invalid snapshot collectedAt");

  // 1) Resolve exits using only newly closed 5m candles.
  const stillOpen = [];
  for (const p of state.openPositions) {
    const raw = snapshot?.deep?.[p.market]?.candles?.["5m"];
    if (!raw) {
      state.stats.monitoringGaps += 1;
      stillOpen.push(p);
      continue;
    }
    const bars = closed5mBars(raw, asOfMs).filter((b) => b.ts > (p.lastEvaluatedCandleOpenTime ?? -Infinity));
    let closed = false;
    for (const b of bars) {
      const hitStop = b.low <= p.stop;
      const hitTarget = b.high >= p.target;
      if (!hitStop && !hitTarget) {
        p.lastEvaluatedCandleOpenTime = b.ts;
        continue;
      }
      const ambiguous = hitStop && hitTarget;
      // Conservative rule when intrabar sequence is unknowable: assume stop first.
      const reason = hitStop ? "STOP" : "TARGET";
      const exitPrice = hitStop ? p.stop : p.target;
      closedTrades.push(closePosition(state, p, { ...b, exitPrice }, reason, ambiguous, snapshot.collectedAt));
      closed = true;
      break;
    }
    if (!closed) stillOpen.push(p);
  }
  state.openPositions = stillOpen;

  // 2) Open at most once per BUY episode (WAIT -> BUY transition).
  const previousActions = { ...(state.lastActionByMarket || {}) };
  const currentSignals = Array.isArray(signalsDoc?.signals) ? signalsDoc.signals : [];
  const currentByMarket = Object.fromEntries(currentSignals.map((s) => [s.market, s.action]));

  const actionable = Array.isArray(signalsDoc?.actionable) ? signalsDoc.actionable : [];
  for (const s of actionable) {
    if (s.action !== "BUY") continue;
    if (previousActions[s.market] === "BUY") continue;
    if (state.openPositions.some((p) => p.market === s.market)) continue;

    const reason = [];
    if (state.openPositions.length >= CFG.maxPositions) reason.push("max positions reached");

    const suggestedAmount = n(s.suggestedAmountEur);
    const suggestedRisk = n(s.suggestedRiskEur);
    const entry = n(s.entry), stop = n(s.stop), target = n(s.target), costs = n(s.roundTripCostPct);
    if (!(suggestedAmount > 0 && suggestedRisk > 0 && entry > 0 && stop > 0 && target > entry && costs >= 0)) {
      reason.push("invalid sizing or structure");
    }

    let amount = suggestedAmount;
    let risk = suggestedRisk;
    if (reason.length === 0) {
      const availableCapital = Math.max(0, state.realizedEquityEur - allocated(state.openPositions));
      const remainingRisk = Math.max(0, CFG.maxCombinedRiskEur - plannedRisk(state.openPositions));
      const riskPerEuro = suggestedRisk / suggestedAmount;
      amount = Math.min(suggestedAmount, availableCapital, remainingRisk / riskPerEuro);
      risk = amount * riskPerEuro;
      if (!(amount > 0 && risk > 0)) reason.push("insufficient capital or risk budget");
    }

    if (reason.length) {
      state.stats.skippedSignals += 1;
      skippedSignals.push({
        snapshotCollectedAt: snapshot.collectedAt,
        market: s.market,
        family: s.family,
        tradeGrade: s.tradeGrade,
        reasons: reason
      });
      continue;
    }

    const closed = closed5mBars(snapshot?.deep?.[s.market]?.candles?.["5m"], asOfMs);
    const lastClosedTs = closed.length ? closed[closed.length - 1].ts : null;
    state.openPositions.push({
      id: `${s.market}|${snapshot.collectedAt}`,
      market: s.market,
      family: s.family,
      tradeGrade: s.tradeGrade,
      score: s.score,
      openedAt: snapshot.collectedAt,
      entry,
      stop,
      target,
      amountEur: amount,
      quantity: amount / entry,
      plannedRiskEur: risk,
      roundTripCostPct: costs,
      initialNetRR: n(s.netRR),
      btcRegimeAtEntry: s.btcRegime ?? signalsDoc.btcRegime ?? null,
      lastEvaluatedCandleOpenTime: lastClosedTs
    });
  }

  state.lastActionByMarket = currentByMarket;
  state.lastProcessedSnapshot = snapshot.collectedAt;

  return { state, closedTrades, skippedSignals };
}

export { CFG, n, closed5mBars, newState, processPaperState };
