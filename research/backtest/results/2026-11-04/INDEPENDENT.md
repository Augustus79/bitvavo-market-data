# Entrées indépendantes de Strict — recherche exploratoire

Règles et univers fixes, aucune optimisation. Ces fenêtres sont rétrospectives, pas une nouvelle validation prospective. Les coûts et la liquidité restent modélisés.

| Fenêtre | Stratégie | Stress | Clos | Net € | Rendement % | DD % | R moyen | Données |
|---|---|---|---:|---:|---:|---:|---:|---|
| development | donchian-breakout | False | 2 | -2.000 | -0.667 | 0.667 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| development | donchian-breakout | True | 0 | 0.000 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| development | trend-pullback | False | 6 | -2.276 | -0.759 | 1.498 | -0.379 | NO_OBSERVED_HOLDING_GAPS |
| development | trend-pullback | True | 1 | 0.323 | 0.108 | 0.251 | 0.323 | NO_OBSERVED_HOLDING_GAPS |
| development | mean-reversion | False | 0 | 0.000 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| development | mean-reversion | True | 0 | 0.000 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | donchian-breakout | False | 0 | 0.000 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | donchian-breakout | True | 0 | 0.000 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | trend-pullback | False | 1 | -1.000 | -0.333 | 0.358 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | trend-pullback | True | 0 | 0.000 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | mean-reversion | False | 0 | 0.000 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | mean-reversion | True | 0 | 0.000 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | donchian-breakout | False | 0 | 0.000 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | donchian-breakout | True | 0 | 0.000 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | trend-pullback | False | 1 | -1.000 | -0.333 | 0.333 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | trend-pullback | True | 0 | 0.000 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | mean-reversion | False | 0 | 0.000 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | mean-reversion | True | 0 | 0.000 | 0.000 | 0.000 | — | NO_OBSERVED_HOLDING_GAPS |
| validation-3-november | donchian-breakout | False | 1 | -1.000 | -0.401 | 0.496 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | donchian-breakout | True | 1 | -1.000 | -0.333 | 0.333 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | trend-pullback | False | 0 | 0.000 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | trend-pullback | True | 0 | 0.000 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | mean-reversion | False | 0 | 0.000 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | mean-reversion | True | 0 | 0.000 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
