# Historical research (offline / spot only)

Pinned sources and exact frozen blob hashes: sources.json. Existing engine files, experiment protocol and production workflows are not modified. No credentials, private API clients, order functions, Worker imports, deployment or main writes.

## Reproduce
Requires Python >=3.10 and Node >=20; no pip/npm dependencies.

```bash
python research/backtest/verify_frozen.py
python -m unittest discover -s research/backtest -p 'test_*.py' -v
node analysis-engine.test.mjs
node paper-trader.test.mjs
node adaptive-shadow.test.mjs
node exit-shadow.test.mjs
node portfolio-shadow.test.mjs
python research/backtest/run.py --fetch-public --max-api-calls 120
# Repeat OFFLINE with the retained candle cache:
python research/backtest/run.py
```

Report: results/REPORT.md and results/report.json. Archive input hashes, normalized candle checksums and API response checksums are recorded. Preserve cache with report; the public API can revise candles later. Cache and report are uploaded as a 30-day GitHub artifact; save externally for long-term reproduction. Re-running with the same verified inputs is deterministic.

The research workflow runs only on the explicitly named research branch and matching paths, with contents:read and persist-credentials:false. It never runs production entrypoints or uses secrets. No schedule, no order endpoints, no auto-merge.

## Interpretation
Ten fixed variants, two cost scenarios, development followed by two chronological validation windows with 48h embargo. No fitted parameters or winner selection. Bars available at end of interval; a signal's availability is max(snapshot, analysis time); execution is next whole 5m open. Positions from previous windows are never carried across splits. Indicators may use earlier completed bars. Stops are checked before target/trail; stop gap fills use min(open,stop) and adverse slippage. Partial sells incur proportional fees. Equity includes estimated liquidation costs and open PnL. Unclosed positions are censored separately, not counted as closed wins.

Sizing uses previous completed candle turnover with a participation cap, not future fill-bar volume. This is a liquidity proxy, not verified order-book execution. 10 EUR minimum notional and unrestricted fractional quantities are conservative research conventions; historical instrument precision/rules are unavailable. Gaps contaminate the entire run. Missing entry data are counted explicitly. No bars are fabricated.

**Research variants are not exact frozen model equivalents.** They impose a 48h time exit, next-bar execution, standardized sizing and modeled spread. adaptive-exit-proxy uses the documented ATR/EMA runner exit and stop-width gate but cannot enforce the original historical 250k turnover / 500 EUR book-depth gates. dynamic-portfolio-proxy reproduces risk multipliers, not the complete context-based shadow engine.

frozen_adapters.mjs calls unchanged libraries and can replay complete historical snapshots in order. Only a single-snapshot smoke test has been run locally; the compact signal journal cannot be passed off as complete snapshots. Reconstructing full historical snapshots from old Git commits remains a separate evidence-recovery route.

The existing shadow table includes all available ledger closes, including pre-registration Strict trades. It is descriptive and cannot be compared as if all variants had the same period, entries or costs. The frozen experiment's existing prospective decision protocol remains authoritative.

## Local verification
14 meaningful Python tests passed, plus the five existing analysis/paper/adaptive/exit/portfolio JS suites. Frozen hashes verified. Full npm test was not run locally because the connector checkout only includes the relevant libraries and suites. A partial local report is explicitly marked BLOCKED_ARCHIVE_ACCESS. The isolated workflow is intended to audit actual compressed archives and run historical simulations.

API contract checked 2026-10-31: https://docs.bitvavo.com/docs/rest-api/get-candlestick-data/
Public GET candles, max 1440, OHLCV; zero-trade intervals may be absent. Bounded sequential calls stop at first network/rate-limit error. No retries or authenticated API access.
