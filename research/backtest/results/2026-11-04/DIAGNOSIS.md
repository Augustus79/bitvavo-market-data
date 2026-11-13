# Diagnostic des pertes — données figées au 4 novembre 2026

| Échantillon | Trades | PnL brut € | Coûts modélisés € | Net € | Gagnants bruts devenus non positifs nets |
|---|---:|---:|---:|---:|---:|
| all | 96 | 7.442 | 47.825 | -40.384 | 0 |
| registered | 93 | 9.902 | 46.535 | -36.634 | 0 |
| november | 13 | -6.872 | 7.579 | -14.450 | 0 |

Les colonnes brutes et de coûts portent uniquement sur les lignes disposant de tous les champs nécessaires. Les tailles des sous-échantillons et le résidu comptable figurent dans diagnosis.json.

## Limites

- Arithmetic on original simulated trades, not actual account PnL.
- Gross PnL excludes modeled costs for the same fills; removing costs could change future entries/sizing, so this is not a cost-free strategy backtest.
- Fee decomposition follows frozen analysis-engine assumptions: trend pullback maker 0.15% plus taker 0.25%; other families taker/taker 0.50%; entry buffer 0.03%; remainder is modeled spread, not exchange receipts.
- No independent causal attribution of entries, stop widths or exit timing is possible from the ledger alone.
- Intrabar MFE and MAE may be ambiguous on exit candles and are not attainable exit prices.
- Ledger does not provide verified continuous execution data for every trade; no implied clean-data certification.
