# M107 — Plan de réconciliation stock (dry-run + prod, GATED)

> Plan d'exécution pour aligner `products.stock_quantity` (legacy) et `SUM(stock_balances)`.
> **Aucune écriture stock réel sans GO explicite.** Le diagnostic read-only est livré
> (`findStockDivergences` / `GET /stock-locations/divergences`, commit 0123cca). Ce doc
> décrit comment réconcilier *sûrement* une fois la direction (A/B/C) tranchée. Réf : `TECHNICAL_DEBT.md` D11, `docs/design/M107-stock-source-of-truth.md`.

## Pré-requis (décisions, non tranchées)
1. **Direction (archi)** : A (legacy = vérité, stock-locations = réseau ; arrêter l'écrasement par `syncLegacyStock`) · B (balances = vérité, legacy = cache dérivé) · C (réconciliation + garde, sans trancher).
2. **Ce que lit le Z/valorisation** : confirmé — valorisation analytique (`product-analytics`) + garde de vente lisent `stock_quantity` ; **le Z fiscal ne lit pas le stock** → la réconciliation est un sujet **gestion/opérationnel, pas fiscal**.

## Étape 1 — DRY-RUN (read-only, déjà disponible, AUCUN risque)
- `GET /stock-locations/divergences[?storeId=]` → liste `{productId, ean, name, legacyQuantity, balancesQuantity, delta}` triée par |delta|.
- **Interprétation** : `delta = legacy − balances`. Sous option B, la correction proposée = `legacy := balancesQuantity` (i.e. appliquer `−delta`). Sous option A, aucune écriture (legacy fait foi ; le fix est d'**arrêter** `syncLegacyStock` d'écraser).
- Exporter le dry-run (CSV) pour revue humaine **avant** toute écriture.

## Étape 2 — REVUE HUMAINE (décision 7 — pas de correction silencieuse de masse)
- Tout écart significatif (seuil à définir, cohérent décision 7 : ≥20 %) → **vérification physique** avant correction, comme une variance d'inventaire. La réconciliation NE DOIT PAS contourner le flux `stock-reconciliation` (flag + raison + validation manager).
- Les petits écarts (arrondis de sync passés) peuvent être corrigés en masse **après** GO, audités.

## Étape 3 — APPLY (PROD, ⛔ GATED — GO explicite requis)
**Non implémenté.** Quand GO + direction :
1. **Backup** de `products.stock_quantity` (snapshot horodaté par magasin) pour rollback.
2. Écriture **idempotente** + **transactionnelle** par lot, bornée par `storeId`, avec `CHECK (quantity >= 0)` posé d'abord.
3. **Audit** par produit corrigé (`stock_adjustment` raison `m107_reconciliation`, ancien→nouveau) via le chemin `stock.adjustStock` (déjà audité post-commit).
4. Si option A : **modifier `syncLegacyStock`** pour ne plus écraser la quantité vendable (le vrai fix forward) — c'est un changement du flux stock → re-tests + GO.
5. Re-lancer le dry-run après : 0 divergence attendue.

## Garde-fous
- Jamais d'`UPDATE` stock de masse hors transaction + hors backup.
- Jamais contourner décision 7 pour les gros écarts.
- Le dry-run reste la source de vérité de « ce qui changerait » ; on n'écrit que ce que le dry-run a listé + revu.

## Statut
- ✅ Dry-run / diagnostic : livré (read-only).
- ⬜ Direction A/B/C : décision archi owner.
- ⛔ Apply prod : GATED (écrit le stock réel) — attend GO + direction.
