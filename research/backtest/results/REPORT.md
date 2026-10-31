# Backtest historique Bitvavo — rapport du 31 octobre 2026

**Aucune stratégie gagnante identifiée.** L’exécution complète a réussi ; la faible taille des échantillons, les trous de données et les hypothèses de liquidité empêchent de conclure à une espérance positive robuste.

## Ce qui a été vérifié

- Sources figées : market-data `88d4a946e68bb0fde7c109f78aa216b270506378` ; account-state `761044838cd8a18be6831c8cbdf0fc1d9ced1a7b`.
- Archives : 134 651 756 octets décompressés ; empreintes et tailles des huit parties scellées vérifiées. Parties actives également lues et hachées. 11 272 snapshots, aucun doublon.
- Période : 18 septembre 2026 à 16:15 UTC → 31 octobre 2026 à 17:25 UTC. Médiane 300,029 s ; p95 355,429 s. Couverture des créneaux de cinq minutes : 89,636 % ; 177 écarts supérieurs à dix minutes ; maximum 15 h 30 min 0,467 s. Ce n’est pas une couverture continue satisfaisante.
- Journal : 134 observations BUY ; 89 nouveaux BUY causaux retenus après contrôles de disponibilité, fraîcheur et observation précédente. Le nombre de BUY baisse encore dans chaque fenêtre et après filtres d’exécution.
- Prix : 64 appels publics GET, tous réussis, pour 64 blocs ciblés. 76 316 bougies uniques de cinq minutes chargées sur 41 marchés, snapshot courant inclus. Les marchés sans BUY ne sont pas intégralement backfillés ; ces chiffres ne constituent pas une couverture de tout Bitvavo.
- Compte : snapshot ponctuel à 278,06 EUR, taker 0,25 % / maker 0,15 %. Le ledger date du 18 septembre. Capital principal simulé : 300 EUR pour cohérence avec les expériences existantes, pas une reconstitution du compte réel.
- Tests : 16 tests Python et cinq suites JS existantes passent, localement et sur GitHub. Les six empreintes des bibliothèques/protocole protégés correspondent avant et après l’exécution. Adaptateurs frozen : test de fumée sur un seul snapshot, pas replay historique complet.

## Lecture des résultats

Les variantes de recherche emploient des entrées à l’ouverture suivante, des tailles normalisées, une liquidité estimée depuis la bougie précédente et une limite de détention de 48 h. Elles ne doivent pas être confondues avec les modèles frozen. Aucun paramètre n’a été ajusté après lecture des fenêtres de validation.

| Variante de recherche, coûts de base | 12–20 octobre : clos / net EUR / R moyen | 22–31 octobre : clos / net EUR / R moyen |
|---|---:|---:|
| Entrées Strict, sortie cible | 9 / +0,74 / −0,103 | 6 / −5,01 / −1,019 |
| Runner 1R | 9 / −0,65 / −0,258 | 6 / −5,01 / −1,019 |
| Runner 1,5R | 9 / −0,95 / −0,290 | 6 / −5,01 / −1,019 |
| Moitié cible, moitié runner | 9 / −0,33 / −0,222 | 6 / −5,01 / −1,019 |
| Sortie Adaptive, proxy d’entrée | 4 / +0,35 / −0,011 | 3 / −2,32 / −1,000 |
| Portefeuille dynamique, proxy | 9 / −1,19 / −0,222 | 6 / −4,56 / −1,019 |
| Sortie Adaptive + portes d’entrée historiques frozen | 2 / −1,76 / −1,000 | 2 / −1,32 / −1,000 |

**La première fenêtre comporte des bougies manquantes pendant certaines positions : ces performances sont contaminées et ne constituent pas des preuves.** Les résultats détaillent toutes les variantes et les scénarios de stress ci-dessous. Les rares sous-variantes sans trou ne comptent que 1 à 2 trades dans cette fenêtre. La seconde fenêtre ne comporte aucun trou observé pendant les positions, mais seulement 1 à 6 trades selon la variante, tous perdants dans ces hypothèses.

La variante avec portes d’entrée historiques a été ajoutée après le premier run, afin de remplacer une information manquante, sans ajuster de seuil. Elle est exploratoire ; elle ne constitue pas une nouvelle validation indépendante. Les 89 qualifications ont aussi été reproduites localement avec un résultat identique octet par octet. Le second run a réutilisé toutes les bougies : zéro appel Bitvavo supplémentaire. Au total : 11 variantes × 2 scénarios × 3 fenêtres = 66 comparaisons.

Les résultats en EUR peuvent légèrement dépasser zéro tandis que le R moyen reste négatif : les tailles diffèrent. Aucun classement par le seul profit brut ou par la plus petite perte n’est justifié. Les intervalles normaux fournis sont purement descriptifs ; ni indépendance des trades, ni correction des essais multiples ne sont établies.

## Limites qui restent à résoudre

Le journal compact n’archive pas les bid/ask, la profondeur de carnet ou le volume 24 h. Nous avons récupéré les 89 snapshots exacts d’entrée dans l’historique Git et réappliqué la fonction qualifyEntry frozen. Aucune correspondance manquante ou de niveaux incohérents n’a été signalée. Les quotes et carnets sont disponibles à ces 89 instants ; la chronologie complète des snapshots n’est pas reconstruite. Les prix d’exécution entre ces instants restent des hypothèses, donc il ne s’agit toujours pas d’un replay exact complet des portefeuilles frozen.

Les absences de bougies peuvent correspondre à une absence de transactions ou à des données manquantes. Aucune interpolation n’a été faite. Les tests affectés conservent toutes les pertes et restent signalés comme contaminés. La précision des quantités et les règles historiques par instrument ne sont pas reconstituées. Le filtre de participation au volume est un proxy, pas une preuve d’exécutabilité.

La recherche de nouvelles combinaisons reste conditionnée aux marchés et BUY sélectionnés historiquement par Strict : elle n’évalue pas des signaux indépendants dans tout l’univers Bitvavo. Il faut une archive complète des marchés et des décisions pour élargir honnêtement cette recherche. Les fenêtres sont rétrospectives et les protocoles prospective frozen restent inchangés.

La suite utile est de traiter explicitement les intervalles sans transactions, compléter la chronologie des snapshots si nécessaire, puis accumuler davantage de fenêtres et de trades avant tout choix. Ce rapport ne recommande aucun passage en live.

## Reproduction et données

Exécution vérifiée : https://github.com/Augustus79/bitvavo-market-data/actions/runs/41225886947

Données persistantes : https://chatgpt.com/library?file_id=libfile_a815d19f43b88191bbabad37c85c0653&account_id=personal

Archive des bougies et des 89 snapshots d’entrée : SHA-256 `d49ab697d3bda1de9d553f39c36c62cff106971f88e3ac1c7c7b353c02edfb44`. Décompresser à côté de run.py pour rétablir cache/. Le SHA ci-dessus correspond à la version finale comprenant les snapshots et les sorties de qualification. Le dépôt source figé fournit les journaux, snapshot.json et les bibliothèques. Exécuter ensuite run.py sans --fetch-public pour travailler hors ligne. Les scripts et les résultats sont conservés sur la branche dédiée ; aucune fusion ni modification de production.

La documentation publique des bougies a été vérifiée le 31/10/2026 : https://docs.bitvavo.com/docs/rest-api/get-candlestick-data/


## Comparaisons appariées des sorties shadow déjà existantes

Sur les mêmes 27 trades par variante, delta moyen de R par rapport à la sortie Strict de référence : runner 1R −0,1305 ; runner 1,5R −0,0602 ; moitié cible/runner −0,0653. Ces trois variantes ont donc moins bien fait en moyenne que leur référence sur cet échantillon observé. Ce constat descriptif ne valide pas Strict et ne donne pas un classement généralisable. Le calcul reproductible figure dans paired_existing.py.


---

# Backtest historique Bitvavo — recherche isolée

Décision : **preuves insuffisantes, aucun modèle gagnant**.

## Audit

État : ARCHIVES_VERIFIED. Signaux BUY causaux : 89.
Snapshots : 11272. Couverture : 2026-09-18T16:15:03.618000+00:00 → 2026-10-31T17:25:49.798000+00:00.
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
| validation-2 | strict-entry-research | False | 6 | -5.011 | -1.670 | 1.670 | -1.019 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | strict-entry-research | True | 5 | -4.602 | -1.534 | 1.534 | -1.017 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | runner-1r | False | 6 | -5.011 | -1.670 | 1.670 | -1.019 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | runner-1r | True | 5 | -4.602 | -1.534 | 1.534 | -1.017 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | runner-1.5r | False | 6 | -5.011 | -1.670 | 1.670 | -1.019 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | runner-1.5r | True | 5 | -4.602 | -1.534 | 1.534 | -1.017 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | half-target-runner | False | 6 | -5.011 | -1.670 | 1.670 | -1.019 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | half-target-runner | True | 5 | -4.602 | -1.534 | 1.534 | -1.017 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | adaptive-exit-proxy | False | 3 | -2.321 | -0.774 | 0.774 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | adaptive-exit-proxy | True | 2 | -1.935 | -0.645 | 0.645 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | adaptive-original-entry-gates | False | 2 | -1.321 | -0.440 | 0.440 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | adaptive-original-entry-gates | True | 1 | -0.935 | -0.312 | 0.312 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | dynamic-portfolio-proxy | False | 6 | -4.561 | -1.520 | 1.520 | -1.019 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | dynamic-portfolio-proxy | True | 5 | -4.152 | -1.384 | 1.384 | -1.017 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | grade-a-runner | False | 3 | -2.321 | -0.774 | 0.774 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | grade-a-runner | True | 2 | -1.935 | -0.645 | 0.645 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | risk-on-runner | False | 1 | -1.000 | -0.333 | 0.333 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | risk-on-runner | True | 1 | -0.935 | -0.312 | 0.312 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | relative-strength-runner | False | 3 | -2.321 | -0.774 | 0.774 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | relative-strength-runner | True | 2 | -1.935 | -0.645 | 0.645 | -1.000 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | single-position | False | 6 | -5.011 | -1.670 | 1.670 | -1.019 | NO_OBSERVED_HOLDING_GAPS |
| validation-2 | single-position | True | 5 | -4.602 | -1.534 | 1.534 | -1.017 | NO_OBSERVED_HOLDING_GAPS |

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
- Historical quotes/books recovered at 89 entry points; no continuous order-book/trade tape or historical precision metadata; execution remains modeled.
- OHLCV gaps can mean no trades or missing data; never forward-filled.
- 48h holding limit changes frozen model economics; research proxies must not be named frozen Strict/Adaptive equivalents.
- Missing held bars contaminate complete portfolio runs; results not eligible as evidence.
- No winner: small samples, costs and market regimes require further prospective validation.
