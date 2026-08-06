# D24 — Alimenter réellement la comparaison N-1 du graphique « Semaine en cours »

> Dette ouverte au fix #109 (2026-07-24). Le graphique est désormais SÛR
> (échelle bornée, état vide propre) mais la barre « Moyenne N-1 » est
> structurellement vide : `weekAvg` n'est jamais alimentée. Ce dossier cadre la
> fermeture. **Aucune migration, lecture seule, aucun impact ventes.**

## 1. État des lieux (factuel)

- `useDashboardData.ts` : `weekAvg: [0×7]` en valeur initiale, **zéro écriture**
  ensuite (vérifié par grep : seules lignes 36-37, 155-156).
- Conséquence UI depuis #109 : barres grises absentes (minHeight 0), % vs N-1
  masqué (choix assumé : pas de « 0 % » mensonger sans référence).
- Le backend expose : `periodSummary` (jours de la période courante) et
  `trend.comparisons.nMinus1` (JOUR COURANT uniquement) — rien pour « les 7
  jours de la semaine, référence N-1 ».

## 2. Décision produit à trancher (owner)

**Option A — « même semaine l'an dernier »** (ISO-semaine N-1 an-1, jour à jour).
: fidèle au libellé « Moyenne N-1 » ; MAIS vide tant que le magasin a
: < 1 an d'historique (cas actuel The Wesley) et sensible aux jours fériés.

**Option B — « moyenne glissante des N dernières semaines »** (reco : N=4, par
jour de semaine, semaine en cours exclue).
: non vide dès 2 semaines d'exploitation ; amortit les à-coups ; libellé UI à
: ajuster (« Moyenne 4 sem. ») pour rester honnête.

**Recommandation** : Option B maintenant (seule utilisable à court terme), champ
calculé côté backend avec la MÉTHODE explicite dans la réponse, pour basculer en
A (ou A-avec-repli-B) quand un an d'historique existera.

## 3. Contrat proposé (backend, lecture seule)

`GET /api/reports/week-reference?storeId=…&method=rolling4|nMinus1`

```json
{
  "method": "rolling4",
  "weeksUsed": 4,
  "days": [
    { "dow": 1, "avgRevenueMinorUnits": 182050 },
    { "dow": 2, "avgRevenueMinorUnits": 160310 },
    …7 entrées, lundi→dimanche, CENTIMES (règle monnaie entière)…
  ]
}
```

- Module `reports` (existant), agrégation SQL sur les ventes validées
  (`sales`), mêmes filtres tenant que `periodSummary` (`req.tenantStoreId`).
- Semaine en cours EXCLUE du calcul ; semaines à zéro comptées (vraie moyenne).
- Aucune écriture, aucune migration, aucun toucher aux entités ventes.

## 4. Câblage frontend (déjà prêt à consommer)

- `useDashboardData` : appeler l'endpoint, poser `weekAvg` (mêmes centimes que
  `weekActual`) + `weekAvgMethod` pour le libellé de légende.
- `WeekBars` (depuis #109) affiche automatiquement barres grises + % dès que la
  référence existe — **zéro changement de composant requis**, hors libellé
  « Moyenne N-1 » → dynamique selon `method`.

## 5. Tests de fermeture

1. Backend : agrégation rolling4 (4 semaines pleines, semaines partielles,
   magasin neuf < 2 semaines → `days` à zéro + `weeksUsed` réel), isolation
   tenant, ventes annulées exclues.
2. Frontend : `weekAvg` alimenté → barres + % visibles (RTL, données réelles
   simulées) ; méthode affichée ; centimes cohérents.
3. Anti-régression #109 conservée (hauteurs bornées, état vide).

## 6. Fermeture

PR unique (backend endpoint + câblage + libellé + tests) → retirer l'entrée
**D24** de `TECHNICAL_DEBT.md`. Gates habituelles : branche + CI verte + GO
owner pour merge/deploy.
