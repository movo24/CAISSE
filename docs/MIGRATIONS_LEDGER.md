# MIGRATIONS_LEDGER.md — registre central des migrations inter-branches

> Anti-récidive **P372** : plusieurs lignées non mergées consomment simultanément des
> numéros de migration. Une vérification « libre sur toutes les refs » ponctuelle ne suffit
> pas — le lot suivant peut la sauter. Ce registre est la source unique du **qui possède quel
> numéro**, de l'**ordre de merge**, et des **pièges d'ordre d'exécution**.
>
> Dernière mise à jour : **2026-07-16** (lot fiche produit ERP P-A/P-B).

## Règle d'or (obligatoire avant de réserver un numéro)

**Toute nouvelle migration DOIT, avant de choisir son timestamp :**
1. Consulter ce registre (numéros réservés par branche non mergée).
2. Vérifier **toutes les refs** (local + remote) :
   ```bash
   for ref in $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes); do
     git ls-tree -r --name-only "$ref" -- packages/backend/src/database/migrations/ \
       | grep -oE '17[0-9]{11}'
   done | sort -u
   ```
3. Choisir un numéro **strictement supérieur** au max de toutes les lignées actives.
4. **Ajouter sa ligne ici dans le même commit** que la migration.

## Lignées actives (range contesté ≥ 1758)

| Timestamp | Migration | Lignée / branche | Statut | Merge requis avant |
|-----------|-----------|------------------|--------|--------------------|
| 1758000000000 | AddStoreGeoAndNetwork | (base) | ✅ **mergé `main`** | — |
| 1759000000000 | EnrichEmployeeStoreAccess | accès + `feat/catalog-refonte` | 🔶 non mergé | — |
| 1759000000001 | CreateEmployeeApplicationAccess | idem | 🔶 non mergé | — |
| 1759000000002 | CreateAccessAuditLog | idem | 🔶 non mergé | — |
| 1759000000003 | CreateUserLoginEvents | idem | 🔶 non mergé | — |
| 1759000000004 | CreateUserSessions | idem | 🔶 non mergé | — |
| 1759000000005 | CreateUserViewEvents | idem | 🔶 non mergé | — |
| 1760000000000 | AddCatalogPhase2Fields | `feat/catalog-refonte` | 🔶 non mergé | — |
| 1761000000000 | CreateProductMediaAndDocuments | `feat/catalog-refonte` | 🔶 non mergé | — |
| 1762000000000 | CreateProductBarcodes | `feat/catalog-refonte` | 🔶 non mergé | — |
| 1763000000000 | CreateProductSuppliers | `feat/catalog-refonte` | 🔶 non mergé | — |
| 1764000000000 | CreateProductChangeLog | `feat/catalog-refonte` | 🔶 non mergé | — |
| 1765000000000 | CreateProductLinksAndSeasonal | `feat/catalog-refonte` | 🔶 non mergé | — |
| 1766000000000 | AddRemainingCatalogFields | `feat/catalog-refonte` | 🔶 non mergé | — |
| **1767000000000** | AddStockMovementSaleLinkage | fiscal stock-journal | ✅ **mergé `main`** (`a7f6f59`) | — |
| **1768000000000** | CompleteProductErpFieldsMA | `feat/product-sheet-erp-pa` | 🔶 non mergé | après catalogue |
| **1769000000000** | ProductMediaKindAndCategoryUnique | `feat/product-sheet-erp-pa` | 🔶 non mergé | après catalogue |
| _libre_ | prochain numéro disponible | — | ⬜ | ≥ **1770000000000** |

## ⚠️ Piège d'ordre d'exécution (1767 vs 1759-1766)

`main` porte `1758` **puis** `1767` (fiscal), **sans** `1759-1766`. La prod a donc déjà exécuté
`1767`. Quand la lignée catalogue (`1759-1766`, timestamps **inférieurs** à 1767) sera mergée,
TypeORM exécutera ces migrations **après** `1767` déjà appliqué (il rejoue toutes les migrations
non exécutées par ordre de timestamp croissant, en sautant celles déjà enregistrées). C'est
**supporté** et **sûr ici** — `1767` touche `stock_movements`/ventes, `1759-1766` touchent
`product_*`/`user_*`/`access_*` : **tables disjointes, aucune dépendance croisée**. À NE PAS
reproduire pour des migrations dépendantes.

## Ordre de merge requis

```
main (1767 déjà présent)
  └── feat/catalog-refonte  (1759-1766)   ← à merger EN PREMIER (Tier-2, GO owner)
        └── feat/product-sheet-erp-pa (1768-1769)  ← ENSUITE (dépend du catalogue)
```

- La fiche ERP **dépend réellement** du catalogue : `product-media/supplier/change-log`
  entities, migration `1760`, `ProductEditPage.tsx` sont **absents d'`origin/main`** (prouvé par
  `git cat-file -e origin/main:<file>` → absent). Pas de découplage possible.
- ⚠️ `feat/catalog-refonte` **n'existe pas comme branche sur `origin`** (local seulement) ; ses
  commits ne sont sur le remote que via l'historique de `feat/product-sheet-erp-pa`. Avant tout
  merge, pousser `feat/catalog-refonte` et lui ouvrir sa propre PR **en premier**.
- Tout merge vers `main` = **Tier-2, GO owner nominatif**.
