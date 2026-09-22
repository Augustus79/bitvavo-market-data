import assert from "node:assert/strict";
import {
  estimateReviewCost,
  extractResponseText,
  countWebSearchCalls,
  extractWebSources,
  compactSignalForReview
} from "./ai-review-lib.js";

const cost = estimateReviewCost({
  model: "gpt-5.6-terra",
  inputTokens: 8000,
  cachedInputTokens: 0,
  outputTokens: 500,
  webSearchCalls: 1,
  usdToEur: 0.87
});
assert.equal(cost.known, true);
assert.ok(Math.abs(cost.estimatedCostUsd - 0.032) < 1e-12);
assert.ok(Math.abs(cost.estimatedCostEur - 0.02784) < 1e-12);

const cached = estimateReviewCost({
  model: "gpt-5.6-terra",
  inputTokens: 10000,
  cachedInputTokens: 4000,
  outputTokens: 1000,
  webSearchCalls: 2,
  usdToEur: 1
});
assert.ok(Math.abs(cached.estimatedCostUsd - 0.0448) < 1e-12);

const fakeResponse = {
  output: [
    {
      type: "web_search_call",
      action: {
        sources: [
          { title: "Official", url: "https://example.com/a" },
          { title: "Duplicate", url: "https://example.com/a" }
        ]
      }
    },
    {
      type: "message",
      content: [{
        type: "output_text",
        text: "{\"ok\":true}",
        annotations: [
          { type: "url_citation", title: "Second", url: "https://example.com/b" }
        ]
      }]
    }
  ]
};

assert.equal(countWebSearchCalls(fakeResponse), 1);
assert.equal(extractResponseText(fakeResponse), "{\"ok\":true}");
assert.deepEqual(extractWebSources(fakeResponse), [
  { title: "Official", url: "https://example.com/a" },
  { title: "Second", url: "https://example.com/b" }
]);

const compact = compactSignalForReview(
  { market: "BTC-EUR", family: "trend pullback", metrics: { "5m": { trend: 1 } } },
  { snapshotCollectedAt: "2026-09-22T12:00:00Z", btcRegime: "risk-on" }
);
assert.equal(compact.market, "BTC-EUR");
assert.equal(compact.btcRegime, "risk-on");

console.log("ai-review tests: OK");
