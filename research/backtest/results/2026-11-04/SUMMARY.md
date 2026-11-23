# Bilan Bitvavo du 4 novembre 2026

**Aucun modèle retenu.** Mise à jour terminée, diagnostic des pertes réalisé, et trois règles d’entrée indépendantes de Strict testées sans ajuster leurs paramètres sur les résultats.

## Périmètre et validation

- Entrées figées au commit `564516019213a54f90ab8e6c4de5d4b3e530086e`, jusqu’au 4 novembre à 16:35 UTC (17:35 à Paris).
- 12412 snapshots de journal, zéro doublon, couverture des créneaux de cinq minutes 90.49 %. 102 BUY causaux et 102 contextes d’entrée complets récupérés.
- Fenêtres antérieures conservées ; nouvelle fenêtre du 2 novembre à 17:00 UTC au 4 novembre à 16:35 UTC, après l’embargo de 48 heures. Le diagnostic descriptif inclut toutes les entrées de novembre.
- 88 comparaisons des 11 variantes existantes (quatre fenêtres, deux scénarios de coûts), plus 24 comparaisons des trois nouvelles règles : 112 simulations. Aucune optimisation de paramètres.
- L’agrégat des résultats paper de novembre avait déjà été consulté : cette extension chronologique n’est pas une validation aveugle entièrement nouvelle. Les règles indépendantes ont été enregistrées avant le calcul de leurs résultats et restent exploratoires.
- 24 tests Python et cinq suites JS existantes passent. Les six empreintes des moteurs/protocole frozen ont été vérifiées sur la branche de recherche et sur la source récente.

## Ce que le diagnostic établit

| Échantillon paper Strict | Trades | PnL brut € | Coûts modélisés € | PnL net € |
|---|---:|---:|---:|---:|
| Tous les trades | 96 | 7.44 | 47.83 | -40.38 |
| Depuis l’enregistrement du protocole | 93 | 9.90 | 46.54 | -36.63 |
| Entrées de novembre | 13 | -6.87 | 7.58 | -14.45 |

Le faible avantage brut cumulé est absorbé par les coûts : 36.50 € de frais d’échange supposés, 2.29 € de buffer d’entrée et 9.03 € de spread implicite. Cette décomposition suit le code frozen : maker/taker pour trend pullback, taker/taker pour les autres familles. Ce sont des hypothèses paper, pas des factures d’exécution réelle.
Les 13 entrées de novembre se terminent toutes au stop et perdent déjà avant coûts. Réduire les frais ne suffirait donc pas à rendre cet échantillon bénéficiaire.
Sur 96 trades, 20 ont un stop structurel inférieur à 0,5 % ; pour 27, le coût aller-retour estimé atteint ou dépasse cette distance. Cela motive une hypothèse de stops économiquement trop étroits, mais ne démontre pas qu’un stop plus large aurait amélioré les résultats.
Les excursions sont disponibles pour 94 trades. 22 perdants ont présenté une excursion favorable d’au moins 1R structurel. Une excursion intrabougie n’est pas un prix de sortie garanti : aucune règle de prise de profit n’est validée par ce seul constat.

## Extension des variantes existantes — coûts de base

| Variante | Clôturés | Net réalisé € | Rendement marqué % | DD marqué % | Données |
|---|---:|---:|---:|---:|---|
| strict-entry-research | 3 | -2.674 | -0.891 | 0.976 | CONTAMINATED_PRICE_REVISIONS |
| runner-1r | 3 | -2.674 | -0.891 | 0.976 | CONTAMINATED_PRICE_REVISIONS |
| runner-1.5r | 3 | -2.674 | -0.891 | 0.976 | CONTAMINATED_PRICE_REVISIONS |
| half-target-runner | 3 | -2.674 | -0.891 | 0.976 | CONTAMINATED_PRICE_REVISIONS |
| adaptive-exit-proxy | 1 | -1.000 | -0.333 | 0.333 | CONTAMINATED_PRICE_REVISIONS |
| adaptive-original-entry-gates | 0 | 0.000 | 0.000 | 0.000 | CONTAMINATED_PRICE_REVISIONS |
| dynamic-portfolio-proxy | 3 | -2.674 | -0.891 | 0.976 | CONTAMINATED_PRICE_REVISIONS |
| grade-a-runner | 1 | -1.000 | -0.333 | 0.333 | CONTAMINATED_PRICE_REVISIONS |
| risk-on-runner | 0 | 0.000 | 0.000 | 0.000 | CONTAMINATED_PRICE_REVISIONS |
| relative-strength-runner | 1 | -1.000 | -0.333 | 0.333 | CONTAMINATED_PRICE_REVISIONS |
| single-position | 3 | -2.674 | -0.891 | 0.976 | CONTAMINATED_PRICE_REVISIONS |

Les valeurs nulles sans trade ne sont pas des performances supérieures. Les résultats portent sur le simulateur de recherche, avec exécution à l’ouverture suivante et coûts/risques définis initialement ; ils ne reproduisent pas exactement les portefeuilles frozen.

## Nouvelles entrées indépendantes de Strict

Univers fixé : BTC-EUR, ETH-EUR, SOL-EUR, XRP-EUR. Bougies de cinq minutes, contexte horaire entièrement clôturé et 600 bougies consécutives de chauffe. Aucun BUY Strict n’est utilisé pour générer ces signaux.

| Règle, coûts de base | Opportunités sur les quatre fenêtres | Rejets pour R/R net insuffisant | Trades clôturés | Net réalisé cumulé € |
|---|---:|---:|---:|---:|
| donchian-breakout | 295 | 286 | 3 | -3.000 |
| trend-pullback | 823 | 740 | 8 | -4.276 |
| mean-reversion | 274 | 223 | 0 | 0.000 |

Ces cumuls descriptifs additionnent des fenêtres ayant chacune un capital réinitialisé : ils ne décrivent pas une courbe de capital continue. Un breakout reste ouvert à la fin de la dernière fenêtre ; son résultat latent figure dans le rendement marqué, pas dans les trades clôturés. Aucun résultat ne donne une preuve positive robuste. Les signaux de retour à la moyenne n’aboutissent à aucun trade évaluable.

## Intégrité des données et reproduction

Le premier calcul s’est arrêté sur des différences de bougies entre sources. Les deux versions ont été conservées : 79 couples marché/timestamp divergent dans le cache final. La convention est verrouillée : ancien cache du 31 octobre, puis autres blocs API, puis snapshot courant ; le nom de source départage les égalités. Cette convention n’établit pas quelle version est vraie. Les fenêtres concernées, incluant la chauffe des règles indépendantes, portent le statut CONTAMINATED_PRICE_REVISIONS ; les trous restent également comptés. L’audit est conservateur à l’échelle de la fenêtre, pas une preuve que chaque trade a été matériellement affecté. Aucune recherche de la version la plus rentable n’a été faite. Une sensibilité chiffrée à toutes les versions alternatives n’a pas été exécutée.
Les sorties économiques calculées sur GitHub ont été reproduites hors ligne sans appels API. Après la complétion des données des quatre marchés, l’audit de la nouvelle fenêtre a identifié six bougies divergentes dans l’univers Strict plutôt que trois à l’étape intermédiaire ; les résultats économiques sont identiques. Le rapport final complet a ensuite été reproduit à l’identique depuis le cache final.
46 nouveaux appels publics de bougies au total : 13 pour l’extension puis 33 pour l’univers indépendant. Les données acquises avant l’arrêt ont été réutilisées ; les 13 nouveaux snapshots d’entrée proviennent uniquement de lectures GitHub. Aucun appel à un modèle IA n’intervient dans le calcul.

Exécution vérifiée : https://github.com/Augustus79/bitvavo-market-data/actions/runs/41871724030

Données : https://chatgpt.com/library?file_id=libfile_4176fce62eb88191b5c7781050ef306f&account_id=personal

SHA-256 de l’archive : `a24c11e4357fe7ea6d2eda5e213bcdb3229eb61af269f813cdd700e364efa360`. Extraire à la racine du dépôt. Commandes et versions dans README.md et protocol-november.json. Le manifeste de l’archive répertorie chaque fichier et son empreinte.

## Décision et suite de recherche

Aucun passage en live ni choix d’un modèle. Les résultats montrent que changer seulement les sorties n’a pas suffi et que les mouvements recherchés sur cinq minutes dépassent rarement les coûts avec une marge adéquate. L’hypothèse suivante à enregistrer serait de chercher des mouvements plus amples sur des horizons d’une à quatre heures, avec peu de règles et une période future réellement réservée. Cela reste une hypothèse de recherche, pas un résultat validé ni une autorisation de modifier les moteurs frozen.

Aucun ordre, aucune modification du live, des moteurs frozen ou de leur protocole, aucun déploiement et aucun merge sur main.
