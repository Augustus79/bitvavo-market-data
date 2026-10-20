import assert from "node:assert/strict";
import {evaluateRestartPreflight} from "./daily-loss-preflight-readonly.mjs";
const now=Date.parse("2026-10-20T13:05:00Z");
const make=()=>({
  nowMs:now,
  liveState:{
    updatedAt:"2026-10-20T13:02:25.057Z",
    autoTradingHalted:true,
    autoTradingHaltReason:"daily realized loss limit reached (€-5.34)",
    autoTradeHistory:[{closedAt:"2026-10-13T22:39:50.840Z",realizedPnlEur:-5.34}],
    autoPositions:[],activePositions:[],manualProtectedPositions:[],manualConditionalPositions:[]
  },
  accountState:{
    ok:true,collectedAt:"2026-10-20T13:03:25.465Z",
    openOrderCount:0,openOrders:[],conditionalOrderDiscovery:{failures:[]},
    balances:[{symbol:"EUR",available:280.68,inOrder:0}]
  },
  liveLock:{owner:null,releasedAt:"2026-10-20T13:03:01.751Z"}
});
{
  const input=make(),before=structuredClone(input);
  const r=evaluateRestartPreflight(input);
  assert.equal(r.recordedStateChecksPassed,true);
  assert.equal(r.shadow.shouldClear,true);
  assert.equal(r.liveRestartAuthorized,false);
  assert.equal(r.liveRestartPerformed,false);
  assert.equal(r.mode,"READ_ONLY_NO_ORDER_NO_HALT_CHANGE");
  assert.deepEqual(input,before);
}
for (const [label,modify] of [
  ["critical",x=>x.liveState.autoTradingHaltReason="CRITICAL: stop failed"],
  ["position",x=>x.liveState.autoPositions.push({market:"SOL-EUR"})],
  ["stale-account",x=>x.accountState.collectedAt="2026-10-19T12:00:00Z"],
  ["failed-account",x=>x.accountState.ok=false],
  ["open-order",x=>{x.accountState.openOrders.push({orderId:"x"});x.accountState.openOrderCount=1;}],
  ["conditional-error",x=>x.accountState.conditionalOrderDiscovery.failures.push("invalid")],
  ["active-lock",x=>x.liveLock.owner="unknown"],
  ["missing-account",x=>delete x.accountState],
  ["future-timestamp",x=>x.liveState.updatedAt="2026-10-20T14:00:00Z"],
  ["invalid-trade",x=>x.liveState.autoTradeHistory=[{closedAt:"garbage",realizedPnlEur:-5}]]
]) {
  const input=make();modify(input);
  const r=evaluateRestartPreflight(input);
  assert.equal(r.recordedStateChecksPassed,false,label);
  assert.equal(r.liveRestartAuthorized,false,label);
}
{
  const input=make();
  input.accountState.balances.push({symbol:"NIL",available:1e-8,inOrder:0});
  const r=evaluateRestartPreflight(input);
  assert.equal(r.liveRestartAuthorized,false);
  assert.ok(r.warnings.includes("non-eur-balances-require-independent-dust-or-position-check"));
}
console.log("bitvavo restart preflight read-only tests: OK");
