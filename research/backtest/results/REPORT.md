# Backtest historique Bitvavo — recherche isolée

Décision : **preuves insuffisantes, aucun modèle gagnant**.

## Audit

État : BLOCKED_ARCHIVE_ACCESS. Signaux BUY causaux : 0.
Snapshots : non lus. Couverture : None → None.
Bougies : 5 minutes. Les carnets et spreads historiques ne sont pas archivés dans le journal compact.

## Résultats comparatifs

| Fenêtre | Variante de recherche | Stress | Clos | Net € | Rendement % | DD marqué % | R moyen | Qualité |
|---|---|---|---:|---:|---:|---:|---:|---|

Comparaison historique non exécutée : archives indisponibles dans cette exécution. Aucun résultat synthétique substitué.

## Simulations existantes : descriptif seulement

```json
{
  "Strict": {
    "Strict": {
      "closed": 82,
      "netPnlEur": -27.86678839225512,
      "meanNetR": -0.29130637093489337,
      "gapped": 0,
      "scope": "DESCRIPTIVE_EXISTING_SHADOW_NOT_COMPARABLE_OOS"
    }
  },
  "Adaptive Runner v1": {
    "Adaptive Runner v1": {
      "closed": 3,
      "netPnlEur": -1.328934271588786,
      "meanNetR": -0.4429780905295953,
      "gapped": 0,
      "scope": "DESCRIPTIVE_EXISTING_SHADOW_NOT_COMPARABLE_OOS"
    }
  },
  "Exit shadows": {
    "full-runner-trail-1r": {
      "closed": 27,
      "netPnlEur": -9.684263185546522,
      "meanNetR": -0.3136208375620819,
      "gapped": 0,
      "scope": "DESCRIPTIVE_EXISTING_SHADOW_NOT_COMPARABLE_OOS"
    },
    "full-runner-trail-1_5r": {
      "closed": 27,
      "netPnlEur": -7.3122213450503875,
      "meanNetR": -0.2433399974557313,
      "gapped": 0,
      "scope": "DESCRIPTIVE_EXISTING_SHADOW_NOT_COMPARABLE_OOS"
    },
    "half-target-runner-trail-1r": {
      "closed": 27,
      "netPnlEur": -7.4820628080771785,
      "meanNetR": -0.24837059718420892,
      "gapped": 0,
      "scope": "DESCRIPTIVE_EXISTING_SHADOW_NOT_COMPARABLE_OOS"
    }
  },
  "Portfolio shadow": {
    "Portfolio shadow": {
      "closed": 28,
      "netPnlEur": -16.086304141355967,
      "meanNetR": -0.561939342566557,
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
- No historical order book, quoted spread, precision/minimum-order metadata or trade tape: only execution proxies.
- OHLCV gaps can mean no trades or missing data; never forward-filled.
- 48h holding limit changes frozen model economics; research proxies must not be named frozen Strict/Adaptive equivalents.
- Missing held bars contaminate complete portfolio runs; results not eligible as evidence.
- No winner: small samples, costs and market regimes require further prospective validation.
