# Adaptive Runner v1 — prospective shadow

This is a separate PAPER-ONLY model. It reads snapshot.json, signals.json and paper/state.json after Strict runs. It never calls the Bitvavo API, changes a Cloudflare Worker, or creates/modifies/cancels orders.

Entry gates: only new Strict BUY rising-edge signals (not restricted by the frozen two-slot paper portfolio), no historical backfill; reject stops narrower than max(0.5% of entry, 0.5 * reported 15m ATR percentage, 0.8 * estimated roundtrip cost). Also require 250k EUR 24h turnover, minimum 500 EUR top-ten bid liquidity, spread <=0.25%, and net RR >=1.5 with stress for stop-fill loss. Simulate with two 0.25% taker fees, 0.03% entry buffer, real reported spread, and 0.40% adverse stop slippage. These assumptions may differ from actual future fills.

Exit: never sell at original target. Original target is only a checkpoint. The whole position runs. On confirmed 5m CLOSE reaching +2 structural R, a trailing stop may tighten using confirmed peak CLOSE, 14-period 5m ATR, and 20-bar EMA price/trend. The stop never moves backwards and must stay at least 1.5 ATR below the latest close; no automatic early break-even. Any stop change applies to future candles, not the candle that generated it. At each candle, the previously effective stop is tested first. Stop fills simulate adverse slippage and gap-down risk.

The model can return part or all of unrealized gains and can lose more than planned in volatile gaps. Missing bar gaps are recorded and the affected closed trade is excluded from the clean sample.

Portfolio cap: 3 simultaneous simulated positions, 1 EUR maximum initial risk per A-grade position (0.80 EUR for B), 3 EUR combined estimated open risk, 100 EUR max per position and 300 EUR starting capital. Capacity is independent of frozen Strict's two slots. BTC and ETH plus eight distinct positions across Strict/Portfolio/Adaptive can be monitored within the 10 deep-market budget; no claim that every possible market has continuous candles.

Reports: adaptive-shadow/latest.json, trades.jsonl, skipped.jsonl, events.jsonl and open-markets.json. Paired comparison against the original Strict paper trades uses normalized R, not raw euros. Minimum 30 clean closed shadow trades before tentative interpretation; the existing frozen experiment remains fully unchanged.

To stop NEW live orders separately, the operator must set LIVE_TRADING_ENABLED=false in Cloudflare. This code neither verifies nor changes that Cloudflare configuration.
