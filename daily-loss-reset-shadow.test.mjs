import assert from "node:assert/strict";
import { evaluateDailyLossResetPolicy as evaluate } from "./daily-loss-reset-shadow-policy.mjs";

const now = Date.parse("2026-10-20T11:30:00Z");
const trade = (closedAt, realizedPnlEur) => ({closedAt, realizedPnlEur});
const check = (changes={}) => evaluate({
  autoTradingHalted: true,
  autoTradingHaltReason: "daily realized loss limit reached (€-5.34)",
  autoTradeHistory: [],
  nowMs: now,
  ...changes
});
{
  const r = check({autoTradeHistory: [
    trade("2026-10-13T06:53:48Z", -1.66),
    trade("2026-10-13T13:43:50Z", -0.61),
    trade("2026-10-13T15:37:53Z", -1.31),
    trade("2026-10-13T22:39:50Z", -1.76)
  ]});
  assert.equal(r.shouldClear, true);
  assert.equal(r.currentUtcDayPnlEur, 0);
}
for (const v of [-5, -5.34]) {
  const r = check({autoTradeHistory:[trade("2026-10-20T08:00:00Z", v)]});
  assert.equal(r.shouldClear,false);
  assert.equal(r.currentUtcDayPnlEur,v);
}
assert.equal(check({
  autoTradingHaltReason: "daily realized loss limit reached (€-5.00)",
  autoTradeHistory:[trade("2026-10-20T08:00:00Z",-2),trade("2026-10-20T10:00:00Z",-3)]
}).shouldClear,false);
assert.equal(check({autoTradeHistory:[
  trade("2026-10-20T08:00:00Z",-5.34),trade("2026-10-20T10:30:00Z",0.35)
]}).shouldClear,true);
for (const reason of [
  "CRITICAL: entry filled on X-EUR but stop and emergency exit both failed",
  "protective stop failed after X-EUR entry; emergency exit submitted",
  "live trading credentials missing while auto position exists",
  "CRITICAL: target exit and stop restoration failed for X-EUR",
  "CRITICAL: protective stop missing for X-EUR",
  "auto entry error: exchange temporarily unavailable",
  "daily realized loss limit reached (€-5.34) CRITICAL: stop missing",
  "daily realized loss limit reached (€-5.34)\nCRITICAL: stop missing",
  "daily realized loss limit reached (€-5.34) (manual halt)",
  "daily realized loss limit reached (€-5.34",
  " daily realized loss limit reached (€-5.34)",
  "daily realized loss limit reached (€5.34)", null,99
]) {
  const r = check({autoTradingHaltReason:reason});
  assert.equal(r.shouldClear,false,String(reason));
  assert.equal(r.isDailyLossHalt,false,String(reason));
}
for (const reason of [
  "daily realized loss limit reached (€-0.50)",
  "daily realized loss limit reached (€-4.99)"
]) {
  assert.equal(check({autoTradingHaltReason:reason}).blockReason,"recorded-loss-below-limit");
}
assert.equal(check({autoTradingHalted:false}).shouldClear,false);
assert.equal(check({autoTradeHistory:[trade("2026-10-19T23:59:59Z",-5.20)],
  nowMs:Date.parse("2026-10-20T00:00:00Z")}).shouldClear,true);
for (const history of [
  null,undefined,{},[null],
  [trade("2026-10-20T10:00:00Z",null)],
  [trade("2026-10-20T10:00:00Z","-5.34")],
  [trade("2026-10-20T10:00:00Z",NaN)],
  [trade("2026-10-20T10:00:00Z",Infinity)],
  [trade("2026-10-20",-5.34)],
  [trade("2026-02-30T10:00:00Z",-5.34)],
  [trade("2026-10-20T13:00:00Z",-5.34)],
  [trade("2026-10-20T10:00:00+02:00",-5.34)]
]) assert.equal(check({autoTradeHistory:history}).shouldClear,false);
for (const value of [null,NaN,Infinity,"2026-10-20T11:30:00Z",1e20]) {
  assert.equal(check({nowMs:value}).shouldClear,false);
}
for (const limitEur of [0,-5,NaN,Infinity,"5"]) {
  assert.equal(check({limitEur}).shouldClear,false);
}
const input={autoTradingHalted:true,
  autoTradingHaltReason:"daily realized loss limit reached (€-5.34)",
  autoTradeHistory:[trade("2026-10-13T08:00:00Z",-5.34)],nowMs:now};
const old=structuredClone(input);
assert.equal(evaluate(input).shouldClear,true);
assert.deepEqual(input,old);
console.log("daily-loss shadow isolated policy regression: OK");
