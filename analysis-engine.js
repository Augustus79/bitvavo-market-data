// Analysis engine v0.6 for Bitvavo snapshot v2.2.
// Reliability-focused, deterministic, read-only: no trading or order execution.

const CFG = {
  maxSnapshotAgeMin: 35,
  makerFeePct: 0.15,
  takerFeePct: 0.25,
  slippageBufferPct: 0.03,
  minNetRR: 1.5,
  scoreB: 7.0,
  scoreA: 8.0,
  riskB: [0.60, 1.00],
  riskA: [1.00, 1.50],
  minClosedBars: 60,
  maxMissingIntervalsRecent: 3,
  maxGapIntervals: 2
};

const INTERVAL_MS = { "5m": 5 * 60e3, "15m": 15 * 60e3, "1h": 60 * 60e3 };
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function n(value) {
  if (value === null || value === undefined || value === "") return null;
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function closedBars(raw, tf, asOfMs) {
  const interval = INTERVAL_MS[tf];
  if (!interval || !Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    .map((r) => {
      if (!Array.isArray(r) || r.length < 6) return null;
      const [t, o, h, l, c, v] = r.map(n);
      if ([t, o, h, l, c, v].some((x) => x === null)) return null;
      return { t, o, h, l, c, v };
    })
    .filter(Boolean)
    .filter((b) => b.t + interval <= asOfMs)
    .sort((a, b) => a.t - b.t)
    .filter((b) => {
      if (seen.has(b.t)) return false;
      seen.add(b.t);
      return true;
    });
}

function gapStats(bars, tf, lookback = 60) {
  const interval = INTERVAL_MS[tf];
  const recent = bars.slice(-lookback);
  let missingIntervals = 0;
  let maxGapIntervals = 0;
  for (let i = 1; i < recent.length; i++) {
    const slots = Math.max(1, Math.round((recent[i].t - recent[i - 1].t) / interval));
    const missing = Math.max(0, slots - 1);
    missingIntervals += missing;
    maxGapIntervals = Math.max(maxGapIntervals, missing);
  }
  return { missingIntervals, maxGapIntervals };
}

function ema(values, period) {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function atr(bars, period = 14) {
  if (bars.length < period + 1) return null;
  const tr = [];
  for (let i = 1; i < bars.length; i++) {
    tr.push(Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c)
    ));
  }
  return mean(tr.slice(-period));
}

function pctReturn(bars, barsAgo) {
  if (bars.length <= barsAgo) return null;
  const now = bars.at(-1)?.c;
  const then = bars.at(-1 - barsAgo)?.c;
  return now && then ? ((now - then) / then) * 100 : null;
}

function pivots(bars, side, left = 2, right = 2, lookback = 80) {
  const b = bars.slice(-lookback);
  const out = [];
  for (let i = left; i < b.length - right; i++) {
    const value = side === "high" ? b[i].h : b[i].l;
    let ok = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      const other = side === "high" ? b[j].h : b[j].l;
      if (side === "high" ? other >= value : other <= value) { ok = false; break; }
    }
    if (ok) out.push({ t: b[i].t, price: value });
  }
  return out;
}

function nearestResistance(metricsList, entry) {
  const prices = [];
  for (const m of metricsList) {
    if (!m) continue;
    for (const p of m.pivotHighs || []) if (p.price > entry) prices.push(p.price);
    if (m.high20 && m.high20 > entry) prices.push(m.high20);
  }
  return prices.length ? Math.min(...prices) : null;
}

function nearestSupport(metricsList, entry) {
  const prices = [];
  for (const m of metricsList) {
    if (!m) continue;
    for (const p of m.pivotLows || []) if (p.price < entry) prices.push(p.price);
    if (m.low20 && m.low20 < entry) prices.push(m.low20);
  }
  return prices.length ? Math.max(...prices) : null;
}

function tfMetrics(raw, tf, asOfMs) {
  const b = closedBars(raw, tf, asOfMs);
  const gaps = gapStats(b, tf);
  if (!b.length) return { bars: b, quality: { ok: false, count: 0, ...gaps } };

  const closes = b.map((x) => x.c);
  const vols = b.map((x) => x.v);
  const last = b.at(-1);
  const e20 = ema(closes.slice(-60), 20);
  const e50 = ema(closes, 50);
  const A = atr(b);
  const prev20 = b.slice(-21, -1);
  const hi20 = prev20.length ? Math.max(...prev20.map((x) => x.h)) : null;
  const lo20 = prev20.length ? Math.min(...prev20.map((x) => x.l)) : null;
  const v20 = mean(vols.slice(-21, -1));
  const quality = {
    ok: b.length >= CFG.minClosedBars && gaps.missingIntervals <= CFG.maxMissingIntervalsRecent && gaps.maxGapIntervals <= CFG.maxGapIntervals,
    count: b.length,
    ...gaps
  };

  return {
    bars: b,
    last: last.c,
    lastOpen: last.o,
    lastBullish: last.c > last.o,
    ema20: e20,
    ema50: e50,
    atr: A,
    atrPct: A && last.c ? 100 * A / last.c : null,
    trend: e20 && e50 ? (last.c > e20 && e20 > e50 ? 1 : last.c < e20 && e20 < e50 ? -1 : 0) : 0,
    breakout: hi20 ? last.c > hi20 : false,
    breakdown: lo20 ? last.c < lo20 : false,
    volumeRatio: v20 ? last.v / v20 : null,
    high20: hi20,
    low20: lo20,
    recentLow: Math.min(...b.slice(-12).map((x) => x.l)),
    ret1h: tf === "15m" ? pctReturn(b, 4) : null,
    ret4h: tf === "1h" ? pctReturn(b, 4) : null,
    pivotHighs: pivots(b, "high"),
    pivotLows: pivots(b, "low"),
    quality
  };
}

function bookMetrics(book) {
  const bids = (book?.bids || []).map((x) => [n(x[0]), n(x[1])]).filter((x) => x[0] !== null && x[1] !== null);
  const asks = (book?.asks || []).map((x) => [n(x[0]), n(x[1])]).filter((x) => x[0] !== null && x[1] !== null);
  const bq = bids.slice(0, 10).reduce((s, x) => s + x[0] * x[1], 0);
  const aq = asks.slice(0, 10).reduce((s, x) => s + x[0] * x[1], 0);
  return {
    imbalance: (bq + aq) ? (bq - aq) / (bq + aq) : null,
    bidDepth10: bq,
    askDepth10: aq,
    levels: { bids: bids.length, asks: asks.length }
  };
}

function btcRegime(btc, asOfMs) {
  const h = tfMetrics(btc.candles["1h"], "1h", asOfMs);
  const m = tfMetrics(btc.candles["15m"], "15m", asOfMs);
  if (!h.quality.ok || !m.quality.ok) return "unknown";
  if (h.trend === 1 && m.trend >= 0) return "risk-on";
  if (h.trend === -1 && m.trend <= 0) return "risk-off";
  return "neutral";
}

function structureForFamily(family, entry, m5, m15, h1) {
  const a5 = m5.atr || 0;
  const a15 = m15.atr || a5;
  let stop = null;
  let stopMethod = null;
  let target = null;
  let targetMethod = null;

  if (family === "trend pullback") {
    const support = nearestSupport([m5, m15], entry);
    if (support) {
      stop = support - 0.20 * a15;
      stopMethod = "nearest 5m/15m support - 0.20 ATR15";
    }
    target = nearestResistance([m15, h1], entry);
    if (target) targetMethod = "nearest 15m/1h structural resistance";
  } else if (family === "confirmed breakout") {
    const level = m15.breakout ? m15.high20 : (m5.breakout ? m5.high20 : null);
    if (level) {
      stop = level - 0.25 * (m15.breakout ? a15 : a5);
      stopMethod = "breakout level - 0.25 ATR";
    }
    target = nearestResistance([h1], entry);
    if (target) targetMethod = "next 1h structural resistance";
  } else if (family === "momentum/relative strength") {
    const support = nearestSupport([m5, m15], entry);
    if (support) {
      stop = support - 0.25 * a15;
      stopMethod = "nearest 5m/15m pivot support - 0.25 ATR15";
    }
    target = nearestResistance([m15, h1], entry);
    if (target) targetMethod = "nearest 15m/1h structural resistance";
  } else if (family === "mean reversion") {
    if (m5.recentLow) {
      stop = m5.recentLow - 0.20 * a5;
      stopMethod = "reversal low - 0.20 ATR5";
    }
    const candidates = [];
    if (m15.ema20 && m15.ema20 > entry) candidates.push({ price: m15.ema20, method: "15m EMA20 mean-reversion target" });
    const resistance = nearestResistance([m15, h1], entry);
    if (resistance) candidates.push({ price: resistance, method: "nearest 15m/1h structural resistance" });
    if (candidates.length) {
      candidates.sort((a, b) => a.price - b.price);
      target = candidates[0].price;
      targetMethod = candidates[0].method;
    }
  }

  if (!(stop < entry)) stop = null;
  if (!(target > entry)) target = null;
  return { stop, stopMethod, target, targetMethod };
}

function evaluate(market, x, btc, regime, asOfMs) {
  const m5 = tfMetrics(x.candles["5m"], "5m", asOfMs);
  const m15 = tfMetrics(x.candles["15m"], "15m", asOfMs);
  const h1 = tfMetrics(x.candles["1h"], "1h", asOfMs);
  const btc15 = tfMetrics(btc.candles["15m"], "15m", asOfMs);
  const btc1h = tfMetrics(btc.candles["1h"], "1h", asOfMs);
  const book = bookMetrics(x.orderBook);
  const spread = n(x.ticker?.spreadPct);
  const entry = n(x.ticker?.ask);
  const dataQualityOk = Boolean(m5.quality.ok && m15.quality.ok && h1.quality.ok && entry && spread !== null);

  const rel1h = market === "BTC-EUR" || m15.ret1h === null || btc15.ret1h === null ? 0 : m15.ret1h - btc15.ret1h;
  const rel4h = market === "BTC-EUR" || h1.ret4h === null || btc1h.ret4h === null ? 0 : h1.ret4h - btc1h.ret4h;
  const candidates = [];

  const qualityAdjust = (base, reasons) => {
    let s = base;
    if (spread !== null && spread <= 0.10) { s += 0.5; reasons.push("tight spread"); }
    else if (spread !== null && spread > 0.30) { s -= 1; reasons.push("wide spread"); }
    if (regime === "risk-on") s += 0.5;
    if (regime === "risk-off" && market !== "BTC-EUR") { s -= 1; reasons.push("BTC risk-off penalty"); }
    if (regime === "unknown") { s -= 1; reasons.push("BTC regime unavailable"); }
    if ((m5.atrPct || 0) > 4) { s -= 0.75; reasons.push("very high 5m volatility"); }
    return clamp(s, 0, 10);
  };

  {
    const reasons = []; let s = 0;
    if (h1.trend === 1) { s += 2.5; reasons.push("1h uptrend"); }
    if (m15.trend === 1) { s += 2; reasons.push("15m uptrend"); }
    const dist15 = m15.ema20 ? Math.abs(m15.last - m15.ema20) / m15.ema20 * 100 : 99;
    const tolerance = Math.max(0.35, (m15.atrPct || 0) * 0.65);
    if (dist15 <= tolerance) { s += 2; reasons.push("15m pullback near EMA20"); }
    if (m5.trend >= 0) { s += 1; reasons.push("5m holding/recovering"); }
    if ((m5.volumeRatio || 0) >= 0.8) { s += 0.5; reasons.push("5m participation adequate"); }
    candidates.push({ family: "trend pullback", score: qualityAdjust(s, reasons), reasons });
  }

  {
    const reasons = []; let s = 0;
    if (h1.trend === 1) { s += 1.5; reasons.push("1h trend supports breakout"); }
    if (m15.breakout) { s += 3; reasons.push("15m breakout"); }
    else if (m5.breakout) { s += 2; reasons.push("5m breakout"); }
    if ((m15.volumeRatio || 0) >= 1.3) { s += 2; reasons.push("15m volume confirmation"); }
    else if ((m5.volumeRatio || 0) >= 1.5) { s += 1.5; reasons.push("5m volume confirmation"); }
    if (m15.trend === 1) { s += 1; reasons.push("15m structure aligned"); }
    candidates.push({ family: "confirmed breakout", score: qualityAdjust(s, reasons), reasons });
  }

  {
    const reasons = []; let s = 0;
    if (h1.trend === 1) { s += 2; reasons.push("1h uptrend"); }
    if (m15.trend === 1) { s += 1.5; reasons.push("15m uptrend"); }
    if (m5.trend === 1) { s += 1; reasons.push("5m aligned"); }
    if (market === "BTC-EUR") {
      if ((m15.ret1h || 0) > 0 && (h1.ret4h || 0) > 0) { s += 1.5; reasons.push("positive 1h/4h momentum"); }
    } else {
      if (rel1h >= 0.5) { s += 1.5; reasons.push("1h relative strength vs BTC"); }
      if (rel4h >= 1.0) { s += 0.5; reasons.push("4h relative strength vs BTC"); }
    }
    if ((m15.volumeRatio || 0) >= 1.0 || (m5.volumeRatio || 0) >= 1.2) { s += 1.5; reasons.push("active volume"); }
    candidates.push({ family: "momentum/relative strength", score: qualityAdjust(s, reasons), reasons });
  }

  {
    const reasons = []; let s = 0;
    const excess = m15.ema20 && m15.atr ? ((m15.ema20 - m15.recentLow) / m15.atr) >= 0.75 : false;
    if (h1.trend <= 0) { s += 1.5; reasons.push("not extended in 1h uptrend"); }
    if (m15.trend === -1) { s += 1.5; reasons.push("15m prior weakness"); }
    if (excess) { s += 2; reasons.push("downside excess vs 15m ATR"); }
    if (m5.trend === 1) { s += 2; reasons.push("5m reversal"); }
    if (m5.ema20 && m5.last > m5.ema20) { s += 0.5; reasons.push("reclaimed 5m EMA20"); }
    if ((m5.volumeRatio || 0) >= 1.2) { s += 1.5; reasons.push("reversal volume"); }
    candidates.push({ family: "mean reversion", score: qualityAdjust(s, reasons), reasons, excess });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const family = best.family;
  const contextScore = best.score;
  const reasons = [...best.reasons];

  let trigger = false;
  const triggerReasons = [];
  if (family === "trend pullback") {
    const nearEma = m15.ema20 && Math.abs(m15.last - m15.ema20) / m15.ema20 * 100 <= Math.max(0.35, (m15.atrPct || 0) * 0.65);
    const recovery = m5.trend === 1 && m5.ema20 && m5.last > m5.ema20 && m5.lastBullish;
    const participation = (m5.volumeRatio || 0) >= 0.8;
    trigger = Boolean(nearEma && recovery && participation);
    if (nearEma) triggerReasons.push("pullback zone reached");
    if (recovery) triggerReasons.push("closed 5m recovery candle confirmed");
    if (participation) triggerReasons.push("closed 5m participation confirmed");
  } else if (family === "confirmed breakout") {
    const broke = Boolean(m15.breakout || m5.breakout);
    const vol = Boolean((m15.volumeRatio || 0) >= 1.3 || (m5.volumeRatio || 0) >= 1.5);
    trigger = broke && vol;
    if (broke) triggerReasons.push("closed-candle range break confirmed");
    if (vol) triggerReasons.push("closed-candle breakout volume confirmed");
  } else if (family === "momentum/relative strength") {
    const aligned = Boolean(h1.trend === 1 && m15.trend === 1 && m5.trend === 1);
    const rs = market === "BTC-EUR" ? ((m15.ret1h || 0) > 0 && (h1.ret4h || 0) > 0) : (rel1h >= 0.5 || rel4h >= 1.0);
    const active = Boolean((m15.volumeRatio || 0) >= 1.0 || (m5.volumeRatio || 0) >= 1.2);
    const notExtended = m15.ema20 && m15.atr ? ((m15.last - m15.ema20) / m15.atr) <= 1.5 : false;
    trigger = aligned && rs && active && notExtended;
    if (aligned) triggerReasons.push("multi-timeframe trend aligned");
    if (rs) triggerReasons.push("intraday momentum/relative strength confirmed");
    if (active) triggerReasons.push("active volume confirmed");
    if (notExtended) triggerReasons.push("not overextended vs 15m ATR");
  } else if (family === "mean reversion") {
    const priorWeakness = Boolean(h1.trend <= 0 && m15.trend === -1);
    const excess = Boolean(best.excess);
    const reversal = Boolean(m5.trend === 1 && m5.ema20 && m5.last > m5.ema20 && m5.lastBullish);
    const vol = Boolean((m5.volumeRatio || 0) >= 1.2);
    trigger = priorWeakness && excess && reversal && vol;
    if (priorWeakness) triggerReasons.push("prior weakness confirmed");
    if (excess) triggerReasons.push("downside excess confirmed");
    if (reversal) triggerReasons.push("closed 5m reversal confirmed");
    if (vol) triggerReasons.push("reversal volume confirmed");
  }

  const contextGrade = contextScore >= CFG.scoreA ? "A" : contextScore >= CFG.scoreB ? "B" : null;
  const score = clamp(contextScore + (trigger ? 2 : 0), 0, 10);
  const tradeGrade = trigger && dataQualityOk ? (score >= CFG.scoreA ? "A" : score >= CFG.scoreB ? "B" : null) : null;
  const structure = entry ? structureForFamily(family, entry, m5, m15, h1) : { stop: null, target: null, stopMethod: null, targetMethod: null };

  const entryFeePct = family === "trend pullback" ? CFG.makerFeePct : CFG.takerFeePct;
  const exitFeePct = CFG.takerFeePct;
  const roundTripCostPct = spread === null ? null : entryFeePct + exitFeePct + spread + CFG.slippageBufferPct;
  const riskPct = entry && structure.stop ? 100 * (entry - structure.stop) / entry : null;
  const grossRewardPct = entry && structure.target ? 100 * (structure.target - entry) / entry : null;
  const netRiskPct = riskPct !== null && roundTripCostPct !== null ? riskPct + roundTripCostPct : null;
  const netRewardPct = grossRewardPct !== null && roundTripCostPct !== null ? grossRewardPct - roundTripCostPct : null;
  const netRR = netRiskPct > 0 && netRewardPct > 0 ? netRewardPct / netRiskPct : null;

  const blockers = [];
  if (!dataQualityOk) blockers.push("data quality gate failed");
  if (!trigger) blockers.push(contextGrade ? "entry trigger absent" : "context score below B threshold");
  if (trigger && !tradeGrade) blockers.push("triggered but trade grade unavailable/below threshold");
  if (!structure.stop) blockers.push("no valid structural invalidation");
  if (!structure.target) blockers.push("no valid structural target");
  if (!(netRR >= CFG.minNetRR)) blockers.push("net structural R/R below threshold");

  const action = blockers.length === 0 ? "BUY" : "WAIT";
  const setupState = action === "BUY" ? "BUY" : trigger ? "TRIGGERED" : contextGrade ? "ARMED" : "WATCH";
  const riskBudget = tradeGrade === "A" ? mean(CFG.riskA) : tradeGrade === "B" ? mean(CFG.riskB) : null;
  const amount = action === "BUY" && riskBudget && netRiskPct > 0 ? riskBudget / (netRiskPct / 100) : null;

  return {
    market,
    action,
    setupState,
    family,
    contextGrade,
    tradeGrade,
    contextScore: Number(contextScore.toFixed(2)),
    score: Number(score.toFixed(2)),
    trigger,
    triggerReasons,
    blockers,
    btcRegime: regime,
    entry,
    stop: structure.stop,
    stopMethod: structure.stopMethod,
    target: structure.target,
    targetMethod: structure.targetMethod,
    riskPct,
    grossRewardPct,
    roundTripCostPct,
    netRR: netRR === null ? null : Number(netRR.toFixed(2)),
    suggestedRiskEur: riskBudget,
    suggestedAmountEur: amount ? Number(amount.toFixed(2)) : null,
    candidateScores: Object.fromEntries(candidates.map((q) => [q.family, Number(q.score.toFixed(2))])),
    metrics: {
      "5m": m5,
      "15m": m15,
      "1h": h1,
      relative1hVsBTC: rel1h,
      relative4hVsBTC: rel4h,
      book
    },
    dataQuality: { "5m": m5.quality, "15m": m15.quality, "1h": h1.quality },
    reasons
  };
}

function analyze(snapshot, now = new Date()) {
  if (snapshot.version !== "2.2") throw new Error("Expected snapshot v2.2");
  const collectedAt = new Date(snapshot.collectedAt);
  if (Number.isNaN(collectedAt.getTime())) throw new Error("Invalid snapshot collectedAt");
  const ageMin = (now.getTime() - collectedAt.getTime()) / 60000;
  const fresh = ageMin >= 0 && ageMin <= CFG.maxSnapshotAgeMin;
  const btc = snapshot.deep?.["BTC-EUR"];
  if (!btc) throw new Error("BTC-EUR missing");
  const asOfMs = collectedAt.getTime();
  const regime = btcRegime(btc, asOfMs);
  let signals = Object.entries(snapshot.deep || {}).map(([m, x]) => evaluate(m, x, btc, regime, asOfMs));

  if (!fresh) {
    signals = signals.map((s) => ({
      ...s,
      action: "WAIT",
      setupState: s.setupState === "BUY" ? "TRIGGERED" : s.setupState,
      blockers: [...new Set([...s.blockers, "snapshot stale"])]
    }));
  }

  signals.sort((a, b) => b.score - a.score);
  return {
    engineVersion: "0.6",
    modelStatus: "experimental-unvalidated",
    snapshotVersion: snapshot.version,
    snapshotCollectedAt: snapshot.collectedAt,
    analyzedAt: now.toISOString(),
    snapshotAgeMin: Number(ageMin.toFixed(2)),
    snapshotFresh: fresh,
    btcRegime: regime,
    config: CFG,
    actionable: signals.filter((x) => x.action === "BUY"),
    signals
  };
}

export { analyze, closedBars, tfMetrics, structureForFamily, n };
