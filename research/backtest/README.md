# Mise à jour du 4 novembre 2026

Lire d’abord [le bilan et le diagnostic](results/2026-11-04/SUMMARY.md). Les résultats du 31 octobre ci-dessous restent archivés séparément.

Données figées au commit `564516019213a54f90ab8e6c4de5d4b3e530086e` (4 novembre à 16:35 UTC). Le protocole additionnel est `protocol-november.json`. Les 11 variantes existantes et leurs paramètres sont inchangés ; la nouvelle fenêtre commence après 48h d’embargo, le 2 novembre à 17:00 UTC. Les trois règles indépendantes sont exploratoires et ne constituent pas une validation aveugle.

Le cache comprend désormais plusieurs versions de certaines bougies. `baseline-price-vintage.json` verrouille les 64 fichiers d’origine. Les désaccords sont conservés dans `cache/price-revisions.json` et les fenêtres concernées sont signalées. L’ordre des sources est explicite : cache d’origine, autres blocs API, snapshot courant. Aucun choix n’est fondé sur la performance.

Données reproductibles : https://chatgpt.com/library?file_id=libfile_4176fce62eb88191b5c7781050ef306f&account_id=personal

Vérifier le SHA-256 dans `results/2026-11-04/dataset.json`, puis extraire l’archive **à la racine du dépôt** : elle restaure `inputs-current/` et `research/backtest/cache/`. Elle contient 242 fichiers de données/provenance, sans credentials. Le manifeste DATASET-MANIFEST.json donne les empreintes des entrées et des scripts utilisés.

Reproduire hors ligne, sans `--fetch-public` :

```bash
python -m unittest discover -s research/backtest -p 'test_*.py' -v
python research/backtest/run.py --root inputs-current --protocol research/backtest/protocol-november.json --out /tmp/bitvavo-november
python research/backtest/independent.py --root inputs-current --protocol research/backtest/protocol-november.json --cache research/backtest/cache --out /tmp/bitvavo-november
python research/backtest/diagnose.py --root inputs-current --out /tmp/bitvavo-november
```

Les résultats finaux ont été reproduits hors ligne. 24 tests Python et cinq suites JS passent. La préparation de données peut être exécutée séparément avec `--prepare-data-only` pour que les calculs s’effectuent sur le cache final. Le workflow est limité à la branche de recherche et possède uniquement les permissions de lecture nécessaires. Aucun merge ni déploiement.

---

## État archivé au 31 octobre

# Bitvavo historical research — isolated spot simulation

All writes are on research/historical-backtest-20261031. No production workflows, frozen engines, protocol or account repository files are changed. No Bitvavo credentials or order client is used. GitHub snapshot recovery uses read-only repository GETs and an optional GH_TOKEN restricted to GitHub.

## Reproduce offline
Python >=3.10; Node >=20; no third-party packages.

1. Check out this branch. Original market-data inputs are pinned at 88d4a946e68bb0fde7c109f78aa216b270506378. Account-state read pin: 761044838cd8a18be6831c8cbdf0fc1d9ced1a7b.
2. Download the permanent dataset below, verify dataset.json SHA-256, and extract beside run.py to restore cache/.
3. Run:

```bash
python research/backtest/verify_frozen.py
python -m unittest discover -s research/backtest -p 'test_*.py' -v
node analysis-engine.test.mjs
node paper-trader.test.mjs
node adaptive-shadow.test.mjs
node exit-shadow.test.mjs
node portfolio-shadow.test.mjs
node research/backtest/qualify_contexts.mjs
python research/backtest/run.py
python research/backtest/paired_existing.py
```

Optional fresh public candle recovery: run.py --fetch-public --max-api-calls 120. Only public GET /v2/{market}/candles is permitted. Fixed UTC chunks, 1440 rows maximum, bounded sequential calls, stop at first HTTP/rate-limit/network error. No missing bar interpolation. Reuse the cache; public API revisions can otherwise change results.
Optional entry snapshot recovery: recover_contexts.py followed by node qualify_contexts.mjs. Existing cached snapshots are reused. Exact collectedAt must match; no approximate substitutions. Frozen qualification is run with an empty portfolio to verify entry market gates; research portfolio constraints are separately modeled.

## Verified execution
GitHub run 41225886947 succeeded. 16 Python tests and five existing JS suites passed. Protected source hashes verified before and after. 89 historical entry snapshots recovered; all 89 gate outputs reproduced locally byte-for-byte. Initial data recovery used 64 public candle GETs; second execution used zero additional Bitvavo calls.

11,272 journal snapshots, no duplicates, 89.636% five-minute grid coverage, 177 intervals over ten minutes, largest gap 15h30. 76,316 loaded five-minute candles across 41 markets, covering selected BUY lifetimes plus warmup, not the whole exchange. 66 fixed comparisons: 11 variants × 2 cost assumptions × 3 chronological windows. No winner.

Permanent dataset: https://chatgpt.com/library?file_id=libfile_a815d19f43b88191bbabad37c85c0653&account_id=personal
Final digest and contents: dataset.json. Includes public candle chunks, 89 exact historical entry snapshots, original frozen gate outputs, recovery provenance and input audit. GitHub artifacts expire after 30 days and are only a temporary convenience.

## Method and limitations
Development Sep22–Oct10; validation Oct12–20 and Oct22–31, separated by 48h embargo. No fitting or automatic parameter selection. Original ten variants were fixed before outcome computation. The eleventh variant adds recovered original Adaptive entry market gates after the initial run, with no changed threshold; it remains exploratory.

Signal availableAt=max(snapshot,analysis timestamp). Execute at the next complete 5m open. Previous completed candle volume constrains notional (1% participation; 0.5% stress), never fill-bar volume. Fees on both legs, spread and adverse slippage, gap-down stop fills, stop before target, trailing changes active next bar, partial exit accounting, marked equity/drawdown, capital/position/risk/daily-loss constraints and censored positions are tracked. Same-timestamp candidates have deterministic score/market priority. Missing held bars contaminate the entire portfolio run rather than selectively excluding losses.

These are research implementations, not exact frozen model equivalents. They impose standardized sizing, next-bar execution, assumed spread and a 48h time exit. The adaptive-original-entry-gates variant calls unchanged qualifyEntry on exact archived entry snapshots, then uses research execution. No continuous order book, trade tape, historical tick/quantity precision or full snapshot timeline is reconstructed. Minimum notional is an explicit research convention of 10 EUR; fractional quantities are not exchange-precision constrained. Full frozen adapters require complete snapshots and have only a single-snapshot smoke test.

The entry universe is conditioned on contemporaneous Strict BUYs in the selected deep-market universe. New filters/exits do not constitute a search of independent signals across all Bitvavo markets. Data are retrospective and validation is not pristine prospective evidence. Descriptive normal intervals are not selection-adjusted or dependence-robust. Small samples and contaminated runs prevent positive-evidence claims; original frozen prospective protocols remain authoritative.

Existing paper/shadow ledger summaries include differing periods, entries, assumptions and pre-registration Strict trades. They are descriptive only. See results/REPORT.md and results/report.json for the full comparison, limitations and provenance.

API documentation checked 2026-10-31: https://docs.bitvavo.com/docs/rest-api/get-candlestick-data/
