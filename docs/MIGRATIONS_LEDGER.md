# MIGRATIONS_LEDGER.md — registre central des migrations inter-branches

> Anti-récidive **P372** : plusieurs lignées non mergées consomment simultanément des
> numéros de migration. Une vérification « libre sur toutes les refs » ponctuelle ne suffit
> pas — le lot suivant peut la sauter. Ce registre est la source unique du **qui possède quel
> numéro**, de l'**ordre de merge**, et des **pièges d'ordre d'exécution**.
>
> Dernière mise à jour : **2026-07-17** (passage d'hygiène : sync main, vérif ordre de merge, pièges post-#84).

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
| **1770000000000** | CreateUserSavedFilters | `feat/product-sheet-erp-pa` (P-D/M-G) | 🔶 non mergé | après catalogue |
| _libre_ | prochain numéro disponible | — | ⬜ | ≥ **1771000000000** |

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
- ✅ `feat/catalog-refonte` est désormais **poussée sur `origin`** (2026-07-17, tip `1fc932f`,
  local == remote). Sa PR (à créer par l'owner) doit être mergée **en premier**, avant celle de
  `feat/product-sheet-erp-pa`.
- Tout merge vers `main` = **Tier-2, GO owner nominatif**.

## Passage d'hygiène 2026-07-17 (fil caisse terrain, ordre owner)

**Table ci-dessus re-vérifiée contre `main@a7f6f59` réelle** : lignée `…1757, 1758, 1767`
confirmée par `git ls-tree` — aucun changement de numérotation requis, statuts exacts.

**Synchronisation des branches en attente** (elles étaient passées en conflit avec `main`
comme la PR #84) : merge de `main` dans `feat/catalog-refonte` (`1fc932f` → `cbeeacf`), puis
répercussion sur la pile `feat/product-sheet-erp-pa`. Conflits = journaux de session
uniquement (`EXECUTION_LOG` / `PROJECT_STATUS` / `TECHNICAL_DEBT`), union stricte, aucun
fichier de code en conflit, push normal (jamais de force). L'ordre de merge requis
ci-dessus **tient toujours**.

### ⚠️ Nouveau piège post-#84 (chevauchement de CODE, pas de numérotation)
La PR **#84** (`claude/customer-display-vertical-eolixp`, fiche produit Phase 1 sans
migration) touche **7 fichiers aussi modifiés par `feat/catalog-refonte`** :
`products.dto.ts`, `employee-store-access.entity.ts`, `main.tsx`, `ProductEditPage.tsx`,
`ProductsPage.tsx`, `productForm.ts`, `services/api.ts`. **Dès que #84 sera mergée dans
`main`, la lignée catalogue passera en conflit de code — non trivial → résolution Tier-2,
GO owner** (en particulier : l'entité ESA devra rester alignée 1711 + 1759, et
`ProductEditPage.tsx` existera sur `main` en version Phase 1, invalidant la preuve
« absent d'origin/main » de la note de dépendance ci-dessus).

### ⚠️ Piège de test « revert par comptage » (classe entière, down() jamais en cause)
Deux specs de migration font `undoLastMigration ×N` en supposant que **leurs** migrations
sont les dernières de la lignée — hypothèse structurellement cassée dès que des lignées
se combinent (par sync de branche aujourd'hui, par merge dans `main` demain) :
- `access-activity-migrations.pg.spec.ts` › « revert ×6 » — ROUGE sur la branche catalogue,
  **préexistant** (vérifié à l'identique sur `1fc932f` non mergé ET après merge, base
  vierge) : `1760-1766` puis `1767` sont au-dessus des `1759x`.
- `stock-movement-linkage-migration.pg.spec.ts` › « down » — VERT sur `main` et sur la
  branche catalogue synchronisée, mais ROUGE sur `feat/product-sheet-erp-pa` synchronisée :
  `1768-1770` sont au-dessus de `1767`, le revert déroule `1770` au lieu de `1767`
  (vérifié : `store_id` encore présent après undo). Ce rouge apparaîtra à l'identique sur
  `main` au moment du merge de la lignée ERP — ce n'est PAS un artefact de la sync.
Correctif de fond (décision des fils propriétaires des specs) : reverter jusqu'à une
migration CIBLE (par nom) au lieu de compter, ou monter une lignée bornée dans le spec.
Les down() eux-mêmes sont sains — c'est la fenêtre de revert des tests qui est fausse.
