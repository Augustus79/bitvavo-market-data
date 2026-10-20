// Standalone, read-only restart audit: no network, trade, or state mutation.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateDailyLossResetPolicy } from "./daily-loss-reset-shadow-policy.mjs";

const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const count = v => Array.isArray(v) ? v.length : null;
const validIso = v => typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(Date.parse(v)).toISOString().slice(0,10) === v.slice(0,10);

export function evaluateRestartPreflight({liveState,accountState,liveLock,nowMs=Date.now()} = {}) {
  const blockers = [];
  const warnings = [];
  if (!isObject(liveState)) blockers.push("live-state-missing");
  if (!isObject(accountState)) blockers.push("account-state-missing");
  if (!isObject(liveLock)) blockers.push("distributed-lock-missing");
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs) ||
      !Number.isFinite(new Date(nowMs).getTime())) blockers.push("clock-invalid");
  const shadow = evaluateDailyLossResetPolicy({
    autoTradingHalted:liveState?.autoTradingHalted,
    autoTradingHaltReason:liveState?.autoTradingHaltReason,
    autoTradeHistory:liveState?.autoTradeHistory,
    nowMs,
    limitEur:5
  });
  if (!shadow.shouldClear) blockers.push("shadow-not-eligible:" + shadow.blockReason);
  for (const [label,at] of [
    ["live-state",liveState?.updatedAt],["account-state",accountState?.collectedAt]
  ]) {
    if (!validIso(at) || !Number.isFinite(nowMs) ||
        Date.parse(at)>nowMs || nowMs-Date.parse(at)>20*60_000) {
      blockers.push(label+"-not-fresh");
    }
  }
  if (accountState?.ok!==true) blockers.push("account-collection-failed");
  if (accountState?.openOrderCount!==0 || count(accountState?.openOrders)!==0) {
    blockers.push("open-orders-not-proven-empty");
  }
  if (count(accountState?.conditionalOrderDiscovery?.failures)!==0) {
    blockers.push("conditional-order-discovery-not-clean");
  }
  for (const key of ["autoPositions","activePositions","manualProtectedPositions","manualConditionalPositions"]) {
    if (count(liveState?.[key])!==0) blockers.push(key+"-not-proven-empty");
  }
  if (liveLock?.owner!==null || !validIso(liveLock?.releasedAt) ||
      Date.parse(liveLock.releasedAt)>nowMs) {
    blockers.push("distributed-lock-not-confirmed-released");
  }
  if (!Array.isArray(accountState?.balances)) blockers.push("account-balances-missing");
  else {
    const nonEur = accountState.balances.filter(b => b?.symbol!=="EUR" &&
      ((typeof b?.available==="number" && b.available>0) ||
      (typeof b?.inOrder==="number" && b.inOrder>0)));
    if (nonEur.length) warnings.push("non-eur-balances-require-independent-dust-or-position-check");
  }
  return {
    mode:"READ_ONLY_NO_ORDER_NO_HALT_CHANGE",
    shadow,
    recordedStateChecksPassed:blockers.length===0,
    recordedStateBlockers:blockers,
    warnings,
    externalVerificationsRequired:[
      "bitvavo-exchange-trade-history-is-complete-and-reconciled",
      "cloudflare-deployed-version-and-live-credentials-independently-verified",
      "fresh-exchange-positions-orders-and-protective-stops-verified-at-resume",
      "explicit-operator-controlled-live-restart"
    ],
    liveRestartAuthorized:false,
    liveRestartPerformed:false
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  const [, , liveStatePath,accountStatePath,lockPath]=process.argv;
  if (!liveStatePath || !accountStatePath || !lockPath) {
    console.error("Usage: node daily-loss-preflight-readonly.mjs live-alert-state.json account-state.json live-state-lock.json");
    process.exitCode=2;
  } else {
    try {
      const report=evaluateRestartPreflight({
        liveState:JSON.parse(readFileSync(liveStatePath,"utf8")),
        accountState:JSON.parse(readFileSync(accountStatePath,"utf8")),
        liveLock:JSON.parse(readFileSync(lockPath,"utf8"))
      });
      console.log(JSON.stringify(report,null,2));
    } catch (error) {
      console.error("Read-only preflight failed: "+error.message);
      process.exitCode=2;
    }
  }
}
