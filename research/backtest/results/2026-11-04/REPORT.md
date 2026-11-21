# Backtest historique Bitvavo — recherche isolée

Décision : **preuves insuffisantes, aucun modèle gagnant**.

## Audit

État : ARCHIVES_VERIFIED. Signaux BUY causaux : 102.
Snapshots : 12412. Couverture : 2026-09-18T16:15:03.618000+00:00 → 2026-11-04T16:35:56.451000+00:00.
Bougies : 5 minutes. Les carnets et spreads historiques ne sont pas archivés dans le journal compact.

## Résultats comparatifs

| Fenêtre | Variante de recherche | Stress | Clos | Net € | Rendement % | DD marqué % | R moyen | Qualité |
|---|---|---|---:|---:|---:|---:|---:|---|
| development | strict-entry-research | False | 22 | -13.276 | -4.425 | 4.946 | -0.713 | CONTAMINATED_GAPS |
| development | strict-entry-research | True | 16 | -11.648 | -3.883 | 4.153 | -0.833 | CONTAMINATED_GAPS |
| development | runner-1r | False | 22 | -13.430 | -4.477 | 5.150 | -0.715 | CONTAMINATED_GAPS |
| development | runner-1r | True | 16 | -11.512 | -3.837 | 4.153 | -0.822 | CONTAMINATED_GAPS |
| development | runner-1.5r | False | 22 | -13.975 | -4.658 | 5.283 | -0.741 | CONTAMINATED_GAPS |
| development | runner-1.5r | True | 16 | -11.642 | -3.881 | 4.153 | -0.833 | CONTAMINATED_GAPS |
| development | half-target-runner | False | 22 | -13.598 | -4.533 | 5.130 | -0.725 | CONTAMINATED_GAPS |
| development | half-target-runner | True | 16 | -11.580 | -3.860 | 4.153 | -0.828 | CONTAMINATED_GAPS |
| development | adaptive-exit-proxy | False | 9 | -6.112 | -2.037 | 2.591 | -0.716 | CONTAMINATED_GAPS |
| development | adaptive-exit-proxy | True | 6 | -4.959 | -1.653 | 1.653 | -1.028 | NO_OBSERVED_HOLDING_GAPS |
| development | adaptive-original-entry-gates | False | 6 | -4.546 | -1.515 | 1.515 | -0.813 | NO_OBSERVED_HOLDING_GAPS |
| development | adaptive-original-entry-gates | True | 4 | -3.582 | -1.194 | 1.194 | -1.042 | NO_OBSERVED_HOLDING_GAPS |
| development | dynamic-portfolio-proxy | False | 22 | -13.552 | -4.517 | 4.882 | -0.725 | CONTAMINATED_GAPS |
| development | dynamic-portfolio-proxy | True | 16 | -11.035 | -3.678 | 3.815 | -0.828 | CONTAMINATED_GAPS |
| development | grade-a-runner | False | 9 | -6.112 | -2.037 | 2.591 | -0.716 | CONTAMINATED_GAPS |
| development | grade-a-runner | True | 6 | -4.959 | -1.653 | 1.653 | -1.028 | NO_OBSERVED_HOLDING_GAPS |
| development | risk-on-runner | False | 5 | -3.432 | -1.144 | 1.703 | -0.753 | CONTAMINATED_GAPS |
| development | risk-on-runner | True | 4 | -2.959 | -0.986 | 0.986 | -1.042 | NO_OBSERVED_HOLDING_GAPS |
| development | relative-strength-runner | False | 7 | -3.910 | -1.303 | 1.862 | -0.606 | NO_OBSERVED_HOLDING_GAPS |
| development | relative-strength-runner | True | 5 | -3.792 | -1.264 | 1.264 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| development | single-position | False | 22 | -13.276 | -4.425 | 4.946 | -0.713 | CONTAMINATED_GAPS |
| development | single-position | True | 16 | -11.648 | -3.883 | 4.153 | -0.833 | CONTAMINATED_GAPS |
| validation-1 | strict-entry-research | False | 9 | 0.744 | 0.248 | 1.467 | -0.103 | CONTAMINATED_GAPS |
| validation-1 | strict-entry-research | True | 4 | 0.133 | 0.044 | 0.848 | 0.033 | CONTAMINATED_GAPS |
| validation-1 | runner-1r | False | 9 | -0.652 | -0.217 | 1.467 | -0.258 | CONTAMINATED_GAPS |
| validation-1 | runner-1r | True | 4 | -0.529 | -0.176 | 0.848 | -0.132 | CONTAMINATED_GAPS |
| validation-1 | runner-1.5r | False | 9 | -0.945 | -0.315 | 1.467 | -0.290 | CONTAMINATED_GAPS |
| validation-1 | runner-1.5r | True | 4 | -0.708 | -0.236 | 0.848 | -0.177 | CONTAMINATED_GAPS |
| validation-1 | half-target-runner | False | 9 | -0.330 | -0.110 | 1.467 | -0.222 | CONTAMINATED_GAPS |
| validation-1 | half-target-runner | True | 4 | -0.515 | -0.172 | 0.848 | -0.129 | CONTAMINATED_GAPS |
| validation-1 | adaptive-exit-proxy | False | 4 | 0.354 | 0.118 | 1.318 | -0.011 | CONTAMINATED_GAPS |
| validation-1 | adaptive-exit-proxy | True | 2 | -2.000 | -0.667 | 0.708 | -1.000 | CONTAMINATED_GAPS |
| validation-1 | adaptive-original-entry-gates | False | 2 | -1.760 | -0.587 | 0.688 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | adaptive-original-entry-gates | True | 1 | -1.000 | -0.333 | 0.375 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | dynamic-portfolio-proxy | False | 9 | -1.186 | -0.395 | 1.467 | -0.222 | CONTAMINATED_GAPS |
| validation-1 | dynamic-portfolio-proxy | True | 4 | -1.136 | -0.379 | 0.813 | -0.129 | CONTAMINATED_GAPS |
| validation-1 | grade-a-runner | False | 4 | 0.354 | 0.118 | 1.318 | -0.011 | CONTAMINATED_GAPS |
| validation-1 | grade-a-runner | True | 2 | -2.000 | -0.667 | 0.708 | -1.000 | CONTAMINATED_GAPS |
| validation-1 | risk-on-runner | False | 1 | -1.000 | -0.333 | 0.435 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | risk-on-runner | True | 1 | -1.000 | -0.333 | 0.375 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | relative-strength-runner | False | 2 | -1.844 | -0.615 | 0.716 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | relative-strength-runner | True | 2 | -1.534 | -0.511 | 0.553 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-1 | single-position | False | 9 | 0.744 | 0.248 | 1.467 | -0.103 | CONTAMINATED_GAPS |
| validation-1 | single-position | True | 4 | 0.133 | 0.044 | 0.848 | 0.033 | CONTAMINATED_GAPS |
| validation-2 | strict-entry-research | False | 6 | -5.011 | -1.670 | 1.670 | -1.019 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | strict-entry-research | True | 5 | -4.602 | -1.534 | 1.534 | -1.017 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | runner-1r | False | 6 | -5.011 | -1.670 | 1.670 | -1.019 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | runner-1r | True | 5 | -4.602 | -1.534 | 1.534 | -1.017 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | runner-1.5r | False | 6 | -5.011 | -1.670 | 1.670 | -1.019 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | runner-1.5r | True | 5 | -4.602 | -1.534 | 1.534 | -1.017 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | half-target-runner | False | 6 | -5.011 | -1.670 | 1.670 | -1.019 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | half-target-runner | True | 5 | -4.602 | -1.534 | 1.534 | -1.017 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | adaptive-exit-proxy | False | 3 | -2.321 | -0.774 | 0.774 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | adaptive-exit-proxy | True | 2 | -1.935 | -0.645 | 0.645 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | adaptive-original-entry-gates | False | 2 | -1.321 | -0.440 | 0.440 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | adaptive-original-entry-gates | True | 1 | -0.935 | -0.312 | 0.312 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | dynamic-portfolio-proxy | False | 6 | -4.561 | -1.520 | 1.520 | -1.019 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | dynamic-portfolio-proxy | True | 5 | -4.152 | -1.384 | 1.384 | -1.017 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | grade-a-runner | False | 3 | -2.321 | -0.774 | 0.774 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | grade-a-runner | True | 2 | -1.935 | -0.645 | 0.645 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | risk-on-runner | False | 1 | -1.000 | -0.333 | 0.333 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | risk-on-runner | True | 1 | -0.935 | -0.312 | 0.312 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | relative-strength-runner | False | 3 | -2.321 | -0.774 | 0.774 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | relative-strength-runner | True | 2 | -1.935 | -0.645 | 0.645 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | single-position | False | 6 | -5.011 | -1.670 | 1.670 | -1.019 | CONTAMINATED_PRICE_REVISIONS |
| validation-2 | single-position | True | 5 | -4.602 | -1.534 | 1.534 | -1.017 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | strict-entry-research | False | 3 | -2.674 | -0.891 | 0.976 | -1.052 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | strict-entry-research | True | 3 | -2.363 | -0.788 | 0.809 | -1.077 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | runner-1r | False | 3 | -2.674 | -0.891 | 0.976 | -1.052 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | runner-1r | True | 3 | -2.363 | -0.788 | 0.809 | -1.077 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | runner-1.5r | False | 3 | -2.674 | -0.891 | 0.976 | -1.052 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | runner-1.5r | True | 3 | -2.363 | -0.788 | 0.809 | -1.077 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | half-target-runner | False | 3 | -2.674 | -0.891 | 0.976 | -1.052 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | half-target-runner | True | 3 | -2.363 | -0.788 | 0.809 | -1.077 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | adaptive-exit-proxy | False | 1 | -1.000 | -0.333 | 0.333 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | adaptive-exit-proxy | True | 1 | -1.000 | -0.333 | 0.333 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | adaptive-original-entry-gates | False | 0 | 0.000 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | adaptive-original-entry-gates | True | 0 | 0.000 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | dynamic-portfolio-proxy | False | 3 | -2.674 | -0.891 | 0.976 | -1.052 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | dynamic-portfolio-proxy | True | 3 | -2.363 | -0.788 | 0.809 | -1.077 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | grade-a-runner | False | 1 | -1.000 | -0.333 | 0.333 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | grade-a-runner | True | 1 | -1.000 | -0.333 | 0.333 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | risk-on-runner | False | 0 | 0.000 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | risk-on-runner | True | 0 | 0.000 | 0.000 | 0.000 | — | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | relative-strength-runner | False | 1 | -1.000 | -0.333 | 0.333 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | relative-strength-runner | True | 1 | -1.000 | -0.333 | 0.333 | -1.000 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | single-position | False | 3 | -2.674 | -0.891 | 0.976 | -1.052 | CONTAMINATED_PRICE_REVISIONS |
| validation-3-november | single-position | True | 3 | -2.363 | -0.788 | 0.809 | -1.077 | CONTAMINATED_PRICE_REVISIONS |

## Simulations existantes : descriptif seulement

```json
{
  "Strict": {
    "Strict": {
      "closed": 96,
      "netPnlEur": -40.38366245678079,
      "meanNetR": -0.3681285767008859,
      "gapped": 0,
      "scope": "DESCRIPTIVE_EXISTING_SHADOW_NOT_COMPARABLE_OOS"
    }
  },
  "Adaptive Runner v1": {
    "Adaptive Runner v1": {
      "closed": 6,
      "netPnlEur": -3.3055975317390924,
      "meanNetR": -0.5509329219565154,
      "gapped": 0,
      "scope": "DESCRIPTIVE_EXISTING_SHADOW_NOT_COMPARABLE_OOS"
    }
  },
  "Exit shadows": {
    "full-runner-trail-1r": {
      "closed": 41,
      "netPnlEur": -23.943050192275404,
      "meanNetR": -0.5198684241128115,
      "gapped": 0,
      "scope": "DESCRIPTIVE_EXISTING_SHADOW_NOT_COMPARABLE_OOS"
    },
    "full-runner-trail-1_5r": {
      "closed": 41,
      "netPnlEur": -21.64634461981772,
      "meanNetR": -0.47505599210635996,
      "gapped": 0,
      "scope": "DESCRIPTIVE_EXISTING_SHADOW_NOT_COMPARABLE_OOS"
    },
    "half-target-runner-trail-1r": {
      "closed": 41,
      "netPnlEur": -20.869893343704454,
      "meanNetR": -0.4599033654758552,
      "gapped": 0,
      "scope": "DESCRIPTIVE_EXISTING_SHADOW_NOT_COMPARABLE_OOS"
    }
  },
  "Portfolio shadow": {
    "Portfolio shadow": {
      "closed": 42,
      "netPnlEur": -25.07789296110338,
      "meanNetR": -0.6276948257287431,
      "gapped": 0,
      "scope": "DESCRIPTIVE_EXISTING_SHADOW_NOT_COMPARABLE_OOS"
    }
  }
}
```

## Limites et protocole

- All historical outcomes have previously existed: this is retrospective OOS, not pristine prospective evidence.
- Fixed variants; no automatic selection or refitting on validation.
- Journal is limited to the contemporaneously selected deep-market universe, with selection bias.
- Historical quotes/books recovered at entry points when contexts are present; no continuous order-book/trade tape or historical instrument precision metadata; execution remains modeled.
- Conflicting cross-source candle vintages are preserved and logged; original Oct31 cache is selected first, then API cache, then snapshot; affected windows are not clean evidence.
- OHLCV gaps can mean no trades or missing data; never forward-filled.
- 48h holding limit changes frozen model economics; research proxies must not be named frozen Strict/Adaptive equivalents.
- Missing held bars contaminate complete portfolio runs; results not eligible as evidence.
- No winner: small samples, costs and market regimes require further prospective validation.
