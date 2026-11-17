# Première comparaison historique des modèles sur 1 h et 4 h

**Aucun modèle gagnant identifié.** Les données permettent une première vision, mais pas une conclusion robuste : très peu de trades sont exécutés, plusieurs positions restent ouvertes et les variantes de bougies sont conservées comme incertitude explicite.

## Périmètre enregistré avant calcul

- Données : du 18 septembre au 17 novembre 2026 à 12:36:03 UTC ; source GitHub figée au commit `52b4a2aec25ea6eafde3be81997cf78455dd7429`.
- Univers fixe : BTC-EUR, ETH-EUR, SOL-EUR et XRP-EUR. Ni sélection des gagnants du jour ni dépendance aux BUY Strict.
- Six modèles : tendance sur repli, cassure et retour à la moyenne, chacun sur 1 h et 4 h. EMA20/50 et ATR14, règles exactes dans higher-protocol.json. Aucune optimisation de seuils.
- Historique complet avant octobre pour la chauffe ; simulation continue du 1er octobre au 17 novembre à 12:35 UTC. Fenêtre de développement du 1er au 15 octobre, validation du 23 octobre au 3 novembre, validation finale du 11 au 17 novembre. Sept jours au minimum entre fenêtres, adaptés à la détention maximale de 168 h. La simulation continue recouvre ces fenêtres et ne compte pas comme preuve indépendante supplémentaire.
- La dernière fenêtre est une validation chronologique historique, pas une expérience prospective aveugle. Les résultats de marché et les agrégats Strict avaient déjà été consultés ; aucun résultat de ces six modèles n’a servi à régler les paramètres.
- Stratégies : 300 EUR au départ, 1 EUR de risque estimé par entrée, deux positions au maximum, 100 EUR maximum par position, limite de risque ouvert 3 EUR et limite quotidienne 5 EUR. Mêmes frais et hypothèses d’exécution que les recherches antérieures. Stop initial à 2 ATR ; cible 3R structurels pour tendance/cassure, EMA20 pour retour à la moyenne ; sortie temporelle après sept jours au plus. Aucun trailing supplémentaire dans cette première comparaison.
- Deux scénarios de coûts pour chaque modèle : base et stress. Exécution à l’ouverture de cinq minutes suivant la disponibilité du signal, frais sur les deux jambes, spread, slippage, priorité au stop en bougie ambiguë, gaps et liquidité de la bougie précédente.
- Références : euros et achat-conservation équipondéré des quatre actifs. L’achat-conservation vise une allocation équipondérée mais les remplissages sont plafonnés par la participation au volume ; du cash peut rester et les poids réels diffèrent. Il n’a ni stop ni risque équivalent à celui des stratégies.

## Première vision — simulation continue du 1er octobre au 17 novembre

Hypothèses de coûts de base, capital initial 300 EUR. Le rendement est calculé sur le capital marqué, avec estimation des coûts de liquidation des positions encore ouvertes.

| Modèle | Trades clôturés | Positions ouvertes | Rendement net % | DD marqué maximum % | R moyen des trades clos |
|---|---:|---:|---:|---:|---:|
| Tendance sur repli — 1 h | 4 | 2 | -1.169 | 1.472 | -1.000 |
| Tendance sur repli — 4 h | 2 | 0 | -0.667 | 0.996 | -1.000 |
| Cassure — 1 h | 7 | 2 | -1.520 | 2.719 | -0.602 |
| Cassure — 4 h | 1 | 0 | -0.333 | 0.374 | -1.000 |
| Retour à la moyenne — 1 h | 0 | 0 | 0.000 | 0.000 | — |
| Retour à la moyenne — 4 h | 0 | 0 | 0.000 | 0.000 | — |
| Conservation en euros | 0 | 0 | 0.000 | 0.000 | — |
| Achat-conservation, cible équipondérée et fills plafonnés | — | 4 | -24.775 | 30.622 | — |

Les deux modèles de retour à la moyenne restent en euros parce qu’aucune entrée n’est admissible. Leur rendement nul ne prouve pas une stratégie rentable. Le modèle cassure 4 h ne compte qu’un seul trade : sa perte plus petite n’en fait pas un meilleur modèle.
La référence achat-conservation investit réellement 251,28 EUR sur les 300 EUR dans le scénario de base et conserve 48,72 EUR. Dans le scénario de stress, la limite de participation plus faible laisse 84,54 EUR en cash pour 215,46 EUR investis. Un stress qui perd moins dans un marché baissier peut donc simplement avoir moins d’exposition : ce n’est pas une preuve de résistance aux coûts. L’allocation réelle par actif figure dans le JSON. Cette télémétrie et cette clarification ont été ajoutées après le premier calcul ; les 60 sorties économiques précédentes sont inchangées.

Les modèles actifs évitent une grande partie de la baisse de l’achat-conservation, mais ils restent souvent en cash et ont une exposition plafonnée. Ce résultat ne démontre ni une capacité à prévoir le marché ni un avantage de rendement ajusté au risque. Aucun des six modèles n’est bénéficiaire sur la simulation continue dans le scénario de base.

## Pourquoi les échantillons restent petits

| Modèle | Opportunités sur la simulation continue | Entrées exécutées | Rejets pour R/R net insuffisant | Rejets de capacité |
|---|---:|---:|---:|---:|
| Tendance sur repli — 1 h | 60 | 6 | 40 | 14 |
| Tendance sur repli — 4 h | 7 | 2 | 0 | 5 |
| Cassure — 1 h | 47 | 9 | 28 | 10 |
| Cassure — 4 h | 1 | 1 | 0 | 0 |
| Retour à la moyenne — 1 h | 113 | 0 | 111 | 0 |
| Retour à la moyenne — 4 h | 23 | 0 | 23 | 0 |

Le filtre de rendement/risque après coûts est identique à celui du moteur de recherche existant (minimum 1,5). Il n’a pas été desserré pour obtenir davantage de trades. Pour les retours à la moyenne, les distances jusqu’à EMA20 sont généralement trop faibles au regard du stop et des coûts ; ils restent non évaluables en performance de trades exécutés.

## Qualité et disponibilité des données

69 616 bougies de cinq minutes ont été chargées pour les quatre marchés sur la période déclarée. La couverture varie de 99,83 % à 99,87 %. Les intervalles absents ne sont pas interpolés ; ils peuvent traduire une absence de transactions ou des données manquantes. Une bougie 1 h/4 h incomplète est rejetée et la chauffe de 60 bougies consécutives doit recommencer.

| Marché | Bougies 1 h complètes | Bougies 1 h après chauffe | Bougies 4 h complètes | Bougies 4 h après chauffe |
|---|---:|---:|---:|---:|
| BTC-EUR | 1450 | 1332 | 361 | 243 |
| ETH-EUR | 1442 | 1065 | 354 | 77 |
| SOL-EUR | 1446 | 1151 | 358 | 117 |
| XRP-EUR | 1444 | 1105 | 355 | 121 |

Deux mois de prix ne produisent donc pas deux mois de décisions possibles pour tous les modèles, particulièrement sur 4 h. Les comptes après chauffe couvrent la totalité de la période de données, y compris avant le début de la simulation ; ce ne sont pas des nombres de trades.
117 couples marché/timestamp ont des valeurs divergentes entre sources archivées. Toutes les versions sont conservées. La convention antérieure est inchangée : cache du 31 octobre prioritaire, puis autres blocs API, puis snapshot courant. Elle assure la reproductibilité, pas la vérité de la version choisie. Les fenêtres affectées, y compris pendant la chauffe, portent le statut CONTAMINATED_PRICE_REVISIONS ; la simulation continue et la dernière validation sont concernées. La sensibilité à toutes les variantes de prix n’a pas été calculée.
Les fenêtres sans conflit de versions comportent parfois des trous pendant les positions. Le statut NO_OBSERVED_HOLDING_GAPS signifie seulement qu’aucun trou n’a été observé pendant la détention, pas une certification d’exécution réelle. Aucun résultat positif robuste ne peut être déduit des données et des tailles d’échantillon présentes.

## Validation, scripts et données

- Protocole et scripts enregistrés au commit `103523280b9844ecac6927e5ae36759bc8b80c54`, avant le calcul de leurs résultats.
- Exécution GitHub 44087423589 réussie : 34 tests Python et les cinq suites JS existantes passent. Les empreintes des six moteurs/protocole frozen sont inchangées, dans la branche et dans les entrées récentes.
- Les 60 comparaisons comprennent 48 simulations des modèles (six modèles × deux coûts × quatre fenêtres), quatre références cash et huit références achat-conservation. Les statistiques de fenêtres qui se recouvrent ne doivent pas être additionnées comme observations indépendantes.
- Rapport JSON et Markdown reproduits hors ligne : comparaison exacte du fichier JSON réussie, sans nouvel appel API.
- Seulement 12 nouveaux appels publics de bougies au total ; le cache antérieur a été réutilisé et la vérification finale n’a fait aucun appel supplémentaire. Aucun appel IA dans le calcul.

Exécution : https://github.com/Augustus79/bitvavo-market-data/actions/runs/44087423589

Données persistantes : https://chatgpt.com/library?file_id=libfile_fde3_f-6be69de0333081918dca918d329625c1_7d0fcd24ccf88191b779961f31cc74ad&account_id=personal

SHA-256 : `2c8e5ce29d5c1e11a905dbce236d4111b86dac647c0993ec8a0e372a59b54851`. Extraire à la racine du dépôt. Les données restaurent higher-inputs/snapshot.json et research/backtest/higher-cache/. Les scripts sont versionnés dans le dépôt ; le manifeste de l’archive contient les empreintes des données et des scripts.

Commande hors ligne :

```bash
python research/backtest/higher.py --root higher-inputs --cache research/backtest/higher-cache --protocol research/backtest/higher-protocol.json --out /tmp/higher-replay
```

## Conclusion de cette première vision

Nous disposons maintenant d’une première comparaison réelle des six modèles, pas d’une preuve qu’une approche est rentable. Les résultats ne justifient de retenir aucun modèle. La prochaine recherche utile serait d’étendre les mêmes règles, sans changer leurs seuils, à une histoire plus longue et à plusieurs régimes de marché ; elle devrait traiter les révisions de prix et la faible disponibilité effective des signaux 4 h. Aucun seuil n’a été modifié après ces résultats.

Aucun ordre, modification du live, changement des moteurs/protocoles frozen, déploiement ou merge sur main.
