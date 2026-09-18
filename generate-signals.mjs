// deterministic signal generation entrypoint
import fs from "node:fs";
import path from "node:path";
import { analyze } from "./analysis-engine.js";

const snapshot = JSON.parse(fs.readFileSync("snapshot.json", "utf8"));
const result = analyze(snapshot, new Date());

fs.writeFileSync("signals.json", JSON.stringify(result, null, 2) + "\n");

function compactTf(tf) {
  if (!tf) return null;
  return {
    last: tf.last ?? null,
    ema20: tf.ema20 ?? null,
    ema50: tf.ema50 ?? null,
    atrPct: tf.atrPct ?? null,
    trend: tf.trend ?? null,
    breakout: tf.breakout ?? null,
    breakdown: tf.breakdown ?? null,
    volumeRatio: tf.volumeRatio ?? null,
    qualityOk: tf.quality?.ok ?? false
  };
}

function compactSignal(s) {
  return {
    market: s.market,
    action: s.action,
    setupState: s.setupState,
    family: s.family,
    contextGrade: s.contextGrade,
    tradeGrade: s.tradeGrade,
    contextScore: s.contextScore,
    score: s.score,
    trigger: s.trigger,
    blockers: s.blockers ?? [],
    entry: s.entry ?? null,
    stop: s.stop ?? null,
    target: s.target ?? null,
    riskPct: s.riskPct ?? null,
    grossRewardPct: s.grossRewardPct ?? null,
    roundTripCostPct: s.roundTripCostPct ?? null,
    netRR: s.netRR ?? null,
    suggestedRiskEur: s.suggestedRiskEur ?? null,
    candidateScores: s.candidateScores ?? {},
    relative1hVsBTC: s.metrics?.relative1hVsBTC ?? null,
    relative4hVsBTC: s.metrics?.relative4hVsBTC ?? null,
    metrics5m: compactTf(s.metrics?.["5m"]),
    metrics15m: compactTf(s.metrics?.["15m"]),
    metrics1h: compactTf(s.metrics?.["1h"]),
    dataQualityOk: Object.values(s.dataQuality ?? {}).every((q) => q?.ok === true)
  };
}

function appendJournal(result) {
  const collected = new Date(result.snapshotCollectedAt);
  if (!Number.isFinite(collected.getTime())) {
    throw new Error("Invalid snapshotCollectedAt; refusing to journal");
  }

  const month = result.snapshotCollectedAt.slice(0, 7);
  const dir = "history";
  const file = path.join(dir, `signals-${month}.jsonl`);
  fs.mkdirSync(dir, { recursive: true });

  const record = {
    schemaVersion: "1.0",
    engineVersion: result.engineVersion,
    modelStatus: result.modelStatus,
    snapshotCollectedAt: result.snapshotCollectedAt,
    analyzedAt: result.analyzedAt,
    snapshotFresh: result.snapshotFresh,
    btcRegime: result.btcRegime,
    actionableMarkets: (result.actionable ?? []).map((x) => x.market),
    signals: (result.signals ?? []).map(compactSignal)
  };

  let existing = "";
  if (fs.existsSync(file)) existing = fs.readFileSync(file, "utf8");

  const alreadyPresent = existing
    .split("\n")
    .filter(Boolean)
    .some((line) => {
      try {
        return JSON.parse(line).snapshotCollectedAt === result.snapshotCollectedAt;
      } catch {
        return false;
      }
    });

  if (!alreadyPresent) {
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
  }

  return { file, appended: !alreadyPresent };
}

const journal = appendJournal(result);

console.log(JSON.stringify({
  engineVersion: result.engineVersion,
  snapshotCollectedAt: result.snapshotCollectedAt,
  snapshotFresh: result.snapshotFresh,
  actionable: result.actionable.map((x) => x.market),
  journal
}, null, 2));
