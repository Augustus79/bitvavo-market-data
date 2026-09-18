import assert from "node:assert/strict";
import { closedBars, n, tfMetrics } from "./analysis-engine.js";

assert.equal(n(null), null);
assert.equal(n(undefined), null);
assert.equal(n(""), null);
assert.equal(n("12.5"), 12.5);
assert.equal(n("abc"), null);

const asOf = Date.parse("2026-09-18T14:15:03.000Z");
const raw = [
  [Date.parse("2026-09-18T14:15:00.000Z"), "100", "101", "99", "100.5", "1"],
  [Date.parse("2026-09-18T14:10:00.000Z"), "99", "101", "98", "100", "10"],
  [Date.parse("2026-09-18T14:05:00.000Z"), "98", "100", "97", "99", "8"]
];

const bars = closedBars(raw, "5m", asOf);
assert.equal(bars.length, 2, "open 14:15 candle must be excluded");
assert.equal(new Date(bars.at(-1).t).toISOString(), "2026-09-18T14:10:00.000Z");

const many = [];
for (let i = 0; i < 70; i++) {
  const t = Date.parse("2026-09-18T08:00:00.000Z") + i * 5 * 60e3;
  many.unshift([
    t,
    String(100 + i * 0.1),
    String(101 + i * 0.1),
    String(99 + i * 0.1),
    String(100.5 + i * 0.1),
    "10"
  ]);
}

const metrics = tfMetrics(many, "5m", Date.parse("2026-09-18T14:00:00.000Z"));
assert.equal(metrics.quality.ok, true);
assert.ok(metrics.ema20 > 0 && metrics.ema50 > 0);

console.log("analysis-engine v0.6 tests: OK");
