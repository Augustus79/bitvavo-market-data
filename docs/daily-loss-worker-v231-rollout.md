# Bitvavo — daily-loss reset v2.31: controlled live rollout

## Scope
Only `worker-v2.js` is changed; frozen engines, strategy thresholds, order placement logic and shadow modules remain unchanged.

**Never change `autoTradingHalted` by editing the private GitHub JSON directly.**

## Safe deployment and explicit opt-in
1. Review merged GitHub source and verify the complete `npm test` GitHub Actions run is green.
2. In Cloudflare Workers dashboard, keep `AUTO_DAILY_LOSS_RESET_ENABLED` **absent or `false`**. Do not enable it during initial deployment.
3. Deploy the updated **standalone** `worker-v2.js` (v2.31) to the existing `bitvavo-collector` Worker using the operator's Cloudflare account. A GitHub merge does **not** deploy Cloudflare automatically.
4. Open the public `/health` endpoint and verify `version: "2.31"`, `alertLayer.dailyLossResetOptInEnabled: false`, existing risk limits, and live credential indicators. No secret value is exposed by `/health`.
5. Independently reconcile the live Bitvavo account (fills/transactions, active/open/conditional orders, all held assets, protective stops). Do not infer absence of risk solely from the GitHub `live-alert-state.json`.
6. Only after confirmation, explicitly set `AUTO_DAILY_LOSS_RESET_ENABLED=true` in Cloudflare. This setting may clear ONLY an expired exact UTC daily-loss halt on a later authenticated `/alert-check` that sees a clean freshly fetched account; it never clears critical halts.
7. The first qualifying alert-check **must not submit any entry order** in its reset cycle. Check the state for `lastAutoRecovery`, `autoTradingHalted=false`, clean risk accounting and fresh account data. Then subsequent eligible checks may submit live orders if `LIVE_TRADING_ENABLED=true`, live credentials are configured and all normal gates pass.
8. To disable further auto-resets, return `AUTO_DAILY_LOSS_RESET_ENABLED=false`. To stop all new live entry orders, independently set `LIVE_TRADING_ENABLED=false` in Cloudflare, while preserving safe management of existing positions.

## Fail-closed requirements
- Exact halt reason `daily realized loss limit reached (€-N.NN)` and N at least the configured 5 EUR limit.
- The current UTC daily realized P&L is **strictly greater than -5 EUR**; every stored history row must have valid UTC timestamp and finite numeric P&L.
- Fresh Bitvavo read-only account data; empty auto and manual positions, no pending reservations, empty open orders and no unresolved conditional-order discovery errors.
- No material unknown holdings, no classification valuation errors, no unmanaged orders, and no active recovery on other critical halt reasons.
- `AUTO_DAILY_LOSS_RESET_ENABLED` must be the literal string `"true"` AND `liveTradingEnabled(env)` must be true.
- The recovery never places an order during the same `/alert-check` cycle.

## Boundaries
- This software guard does **not** prove Bitvavo's fill/transaction history is complete. Independent reconciliation is an operational prerequisite.
- Merging v2.31 alone cannot release the stored halt. Deploy and opt in explicitly after review.
- Existing limits: 1 auto position, 100 EUR max auto notional, 5 EUR daily realized loss, spot only and protective exchange stop. Do not change frozen SHA values.
