# Comparaison historique spot — modèles 1 h et 4 h

**Étude exploratoire : aucun gagnant déclaré.** Six règles fixées à l’avance ; mêmes coûts, capital et limites de risque pour les stratégies. La conservation en euros et l’achat-conservation sont des références.

La ligne overview est une simulation continue qui recouvre les autres fenêtres ; elle ne constitue pas une validation supplémentaire indépendante. Les deux fenêtres de validation sont séparées de sept jours des fenêtres précédentes. Elles restent historiques, pas prospectives.

| Fenêtre | Modèle | Stress | Clos | Ouverts | Rendement net marqué % | DD marqué % | R moyen clos | Qualité |
|---|---|---|---:|---:|---:|---:|---:|---|
| overview | trend-pullback-1h | False | 4 | 2 | -1.169 | 1.472 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| overview | trend-pullback-1h | True | 1 | 2 | -0.308 | 0.370 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| overview | trend-pullback-4h | False | 2 | 0 | -0.667 | 0.996 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| overview | trend-pullback-4h | True | 2 | 0 | -0.667 | 0.914 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| overview | breakout-1h | False | 7 | 2 | -1.520 | 2.719 | -0.602 | CONTAMINATED_PRICE_REVISIONS |
| overview | breakout-1h | True | 1 | 1 | -0.413 | 0.443 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| overview | breakout-4h | False | 1 | 0 | -0.333 | 0.374 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| overview | breakout-4h | True | 0 | 0 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| overview | mean-reversion-1h | False | 0 | 0 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| overview | mean-reversion-1h | True | 0 | 0 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| overview | mean-reversion-4h | False | 0 | 0 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| overview | mean-reversion-4h | True | 0 | 0 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| overview | EUR-cash | False | 0 | 0 | 0.000 | 0.000 | — | DETERMINISTIC_CASH_REFERENCE |
| overview | buy-hold-equal4 | False | — | 4 | -24.775 | 30.622 | — | CONTAMINATED_PRICE_REVISIONS |
| overview | buy-hold-equal4 | True | — | 4 | -21.145 | 26.170 | — | CONTAMINATED_PRICE_REVISIONS |
| development | trend-pullback-1h | False | 3 | 0 | -0.768 | 1.005 | -1.000 | CONTAMINATED_GAPS |
| development | trend-pullback-1h | True | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| development | trend-pullback-4h | False | 2 | 0 | -0.667 | 0.996 | -1.000 | CONTAMINATED_GAPS |
| development | trend-pullback-4h | True | 2 | 0 | -0.667 | 0.914 | -1.000 | CONTAMINATED_GAPS |
| development | breakout-1h | False | 4 | 0 | -1.333 | 1.908 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| development | breakout-1h | True | 1 | 0 | -0.333 | 0.333 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| development | breakout-4h | False | 1 | 0 | -0.333 | 0.374 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| development | breakout-4h | True | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| development | mean-reversion-1h | False | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| development | mean-reversion-1h | True | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| development | mean-reversion-4h | False | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| development | mean-reversion-4h | True | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| development | EUR-cash | False | 0 | 0 | 0.000 | 0.000 | — | DETERMINISTIC_CASH_REFERENCE |
| development | buy-hold-equal4 | False | — | 4 | -6.440 | 9.866 | — | CONTAMINATED_GAPS |
| development | buy-hold-equal4 | True | — | 4 | -5.485 | 8.348 | — | CONTAMINATED_GAPS |
| validation-1 | trend-pullback-1h | False | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | trend-pullback-1h | True | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | trend-pullback-4h | False | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | trend-pullback-4h | True | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | breakout-1h | False | 1 | 0 | -0.333 | 0.566 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | breakout-1h | True | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | breakout-4h | False | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | breakout-4h | True | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | mean-reversion-1h | False | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | mean-reversion-1h | True | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | mean-reversion-4h | False | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | mean-reversion-4h | True | 0 | 0 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | EUR-cash | False | 0 | 0 | 0.000 | 0.000 | — | DETERMINISTIC_CASH_REFERENCE |
| validation-1 | buy-hold-equal4 | False | — | 4 | -5.954 | 7.283 | — | CONTAMINATED_GAPS |
| validation-1 | buy-hold-equal4 | True | — | 3 | -5.607 | 6.587 | — | CONTAMINATED_GAPS |
| validation-2 | trend-pullback-1h | False | 1 | 2 | -0.401 | 0.468 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | trend-pullback-1h | True | 1 | 2 | -0.308 | 0.370 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | trend-pullback-4h | False | 0 | 0 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | trend-pullback-4h | True | 0 | 0 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | breakout-1h | False | 0 | 2 | -0.115 | 0.210 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | breakout-1h | True | 0 | 1 | -0.080 | 0.110 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | breakout-4h | False | 0 | 0 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | breakout-4h | True | 0 | 0 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | mean-reversion-1h | False | 0 | 0 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | mean-reversion-1h | True | 0 | 0 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | mean-reversion-4h | False | 0 | 0 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | mean-reversion-4h | True | 0 | 0 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | EUR-cash | False | 0 | 0 | 0.000 | 0.000 | — | DETERMINISTIC_CASH_REFERENCE |
| validation-2 | buy-hold-equal4 | False | — | 4 | -8.238 | 14.263 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | buy-hold-equal4 | True | — | 4 | -6.438 | 10.906 | — | CONTAMINATED_PRICE_REVISIONS |

## Limites

- About two months of prices: enough for a first view, not proof across market regimes; 4h trade counts may be very small.
- No tuning or automatic model selection; current and earlier market/Strict outcomes were already visible. Final chronological window is not pristine prospective evidence.
- Each strategy has the same 300 EUR capital and risk limits. Passive buy-and-hold targets equal weights but may leave cash due to volume participation limits; no stops, so its risk/exposure differs. Stress changes both costs and liquidity, so lower stress losses do not demonstrate cost robustness.
- All costs and liquidity are modeled. Spot only, previous 5m volume participation, next 5m open, adverse stop slippage and stop-first intrabar policy.
- Max hold 168h for all six models; positions open at cutoff remain censored. Marked return includes estimated liquidation costs; mean R counts closed trades only.
- A higher-timeframe candle is rejected if any underlying 5m candle is missing; no interpolation. Indicator history resets on missing higher bars.
- Candle revisions use the existing original-cache-first policy and remain explicitly logged; affected windows including warmup are flagged.
- Four fixed major assets are a chosen research universe, not an exhaustive or survivorship-free exchange universe.
- Frozen engines/protocols and live trading are unchanged. No orders or deployments.
