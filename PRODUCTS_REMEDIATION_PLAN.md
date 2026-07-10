# PRODUCTS_REMEDIATION_PLAN — Plan de correction par blocs autonomes

> Issu de l'audit 2026-07-10 (`AUDIT_PRODUCTS_COMPLETE.md`). Chaque bloc est autonome,
> livrable en une PR, testable, réversible. ⚠️ = contient une opération Tier-2 (migration
> produits/vente ou surface fiscale) → **GO owner nommé requis avant exécution**, conformément
> à la charte (`.claude/rules/continuity.md`). Aucun bloc n'est commencé sans présentation
> préalable du verdict (fait) et GO.

## Bloc R1 — Backoffice : réparer création/modification produit (P0) 
- **Objectif** : l'écran principal produits peut créer et modifier un produit.
- **Fichiers** : `packages/backoffice-web/src/pages/ProductsPage.tsx` (payload `priceMinorUnits`/`stockQuantity`/`categoryId`, retirer `storeId` ; exposer `costMinorUnits`, `taxRate`, `description`, seuils ; validation client EAN requis), `api.ts` (types).
- **Migrations** : aucune. **Tests** : test de contrat payload↔DTO (source-level ou supertest).
- **Risque** : faible (front seul). **Dépendances** : aucune. 
- **Terminé quand** : créer + modifier depuis l'UI passent en réel ; champ coût alimenté → price-analytics complet.

## Bloc R2 — ⚠️ Migration `price_history` (P0)
- **Objectif** : le schéma prod accepte ce que le code écrit ; l'override de prix magasin ne plante plus ; l'historique n'est plus perdu.
- **Fichiers** : nouvelle migration `1755…-AlignPriceHistory` (ADD COLUMN `store_id uuid NULL`, `change_source varchar NULL`, `changed_by_role varchar NULL` — additive, réversible) ; retirer le try/catch silencieux de `products.service.ts:355-368` ou le transformer en alerte.
- **Tests** : spec PG « migrations vs entités » (voir R10) + test setStoreOverride sur schéma migré (non synchronize).
- **Risque** : faible techniquement (additif) mais **Tier-2** (migration périmètre produits) → GO owner requis.
- **Terminé quand** : boot prod avec `migrationsRun` passe ; override posé/retiré sans erreur ; historique tracé.

## Bloc R3 — ⚠️ Void pack : restaurer les composants (P0/P1)
- **Objectif** : symétrie exacte création↔void, comme le retour.
- **Fichiers** : `sales.service.ts` (`voidSale` : relire `sale_component_movements` par ligne et re-créditer `quantityConsumed` dans la même tx) ; **aucun changement de hash** (stock hors empreinte).
- **Tests d'abord (rouges)** : void d'une vente pack → stocks composants restaurés ; void sans pack inchangé ; idempotence void-once conservée ; suite `void-m4-journal-chain` sans régression.
- **Risque** : moyen (surface vente/fiscal-adjacente) → **GO owner requis**. **Dépendances** : aucune.
- **Terminé quand** : test rouge → vert, `avoir-m1-m3`/`void-*` verts, PG packs verts.

## Bloc R4 — Sync offline : idempotence + bornes stockAdjustments, durcissement `/sync/push` ventes (P1)
- **Objectif** : un rejeu de push n'applique jamais deux fois ; aucun delta ne rend le stock négatif ; les ventes offline insérées respectent ticket/hash serveur (ou sont rejetées vers POST /sales).
- **Fichiers** : `sync.service.ts` (clé d'idempotence par ajustement + `GREATEST(0,…)`/conditionnel ; pour les ventes : soit recalcul ticket+hash serveur, soit dépréciation de la voie au profit de POST /sales+Idempotency-Key déjà saine), entité légère de clé si besoin (⚠️ si migration → GO).
- **Tests** : rejeu même payload → une application ; delta négatif borné ; vente rejouée → une seule ; chaîne fiscale intacte après push.
- **Risque** : moyen. **Dépendances** : décision produit sur la voie `/sync/push` (garder/déprécier).
- **Terminé quand** : les 4 tests ci-dessus verts + `fiscal-verify` sans orphelin après push.

## Bloc R5 — POS : catalogue persistant offline + parité desktop/iPad (P0/P1)
- **Objectif** : démarrage à froid hors ligne opérationnel ; un seul comportement catalogue/scan.
- **Fichiers** : `pos-desktop` — persistance catalogue IndexedDB (réutiliser le pattern mediaStore), chargement au boot + revalidation online ; extraire la logique dupliquée `POSPage` inline vers `useCart` (refresh périodique + anti-double-scan sur les deux chemins).
- **Tests** : unitaires store/cache ; e2e Playwright « boot offline → scan → vente en file ».
- **Risque** : moyen (refactor POS) — pas de Tier-2. **Dépendances** : aucune.
- **Terminé quand** : e2e offline vert ; desktop et iPad partagent le même module catalogue.

## Bloc R6 — Cohérences produit : `isActive`↔`status`, prix négatif, motif d'ajustement (P1)
- **Objectif** : fermer trois incohérences serveur.
- **Fichiers** : `products.service.ts` (`update()` réaligne `status` quand `isActive` change, et inversement ; garde `priceMinorUnits >= 0` dans create/update) ; `stock.service.ts` (`adjustStock` : `reason` non-vide obligatoire) ; DTO correspondants.
- **Tests** : unitaires des trois gardes + non-régression (920+).
- **Risque** : faible. **Terminé quand** : gardes testées, aucun test existant cassé.

## Bloc R7 — Import CSV niveau réel magasin (P2)
- **Objectif** : importer un catalogue français réel de plusieurs milliers de lignes.
- **Fichiers** : `csv.util.ts` (détection séparateur `,`/`;`), `main.ts` (limite body explicite, ex. `json({limit:'10mb'})` scoped), `products.service.ts` (mode dry-run = rapport sans écriture ; option transaction englobante ; colonnes optionnelles `category`, `sku`, `stock_quantity`), UI (prévisualisation avant envoi).
- **Tests** : `csv.util` unitaires (`;`, quotes, BOM), importCsv backend (upsert, dry-run, rejets), volumétrie 1k/10k.
- **Risque** : faible-moyen. **Dépendances** : R1 (écran produit sain d'abord).
- **Terminé quand** : import 10 000 lignes `;` UTF-8/latin-1 avec rapport exact et zéro écriture en dry-run.

## Bloc R8 — Backoffice catalogue : pagination, catégories, marques/fournisseurs sur fiche (P2)
- **Objectif** : backoffice exploitable au-delà de 50 produits, taxonomie réelle.
- **Fichiers** : `ProductsPage.tsx` (pagination serveur pilotée, filtres brand/supplier existants côté API), branchement `GET/POST /products/categories` (sélecteur `categoryId`), `brandId`/`supplierId` ajoutés aux DTO produit (backend) + sélecteurs UI ; unification gestion d'erreurs (bandeaux, pas d'`alert()`).
- **Tests** : contrat DTO, pagination, non-régression.
- **Risque** : faible. **Dépendances** : R1.
- **Terminé quand** : 200+ produits navigables, produit rattachable à catégorie/marque/fournisseur depuis l'UI.

## Bloc R9 — POS scan robuste (P2)
- **Objectif** : scans réels fiables en caisse.
- **Fichiers** : `pos-desktop` — normalisation UPC-A↔EAN-13 + zéros de tête au lookup ; recherche insensible aux accents (`normalize('NFD')`) ; blocage/avertissement au scan d'un produit inactif ou en rupture (au scan, pas seulement au paiement) ; virtualisation de la grille (gros catalogue).
- **Tests** : unitaires normalisation/recherche ; e2e scan produit inactif.
- **Risque** : faible. **Dépendances** : R5 (module catalogue unifié).
- **Terminé quand** : matrice de scans (EAN-8/13, UPC, zéros) verte.

## Bloc R10 — Filet de tests structurels (P2)
- **Objectif** : empêcher la récurrence des classes de bugs trouvées.
- **Contenu** : spec PG (CI) « migrations exécutées vs métadonnées d'entités » (attrape tout futur G2) ; tests unitaires `create/update/importCsv` ; test cumul des 4 remises dans `createSale` ; test E2E HTTP minimal (supertest) produit→vente→retour ; DTO class-validator pour les endpoints `body: any` (promo-codes, brands/suppliers/categories, components, variants, store-price, returns by-ticket) + pagination des listes non paginées.
- **Risque** : faible. **Dépendances** : aucune (peut démarrer en parallèle de R1).
- **Terminé quand** : CI attrape un écart schéma volontairement introduit ; endpoints `any` refusent un champ inconnu.

## Blocs de décision produit (pas de code avant arbitrage owner)

| Décision | Options |
|---|---|
| D-A Packs imbriqués | (1) interdire un composant lui-même composé (garde à l'ajout) — simple ; (2) récursion vente/retour — complexe. Recommandation : (1). |
| D-B Retour carte | (1) refund Stripe automatique depuis `createReturn` (⚠️ paiement réel = Tier-2) ; (2) statu quo documenté + écran « refunds à exécuter ». Recommandation : (2) court terme. |
| D-C Voie `/sync/push` ventes | (1) déprécier au profit de POST /sales+clé (POS l'utilise déjà) ; (2) durcir (recalcul serveur). Recommandation : (1). |
| D-D Journal de stock unifié | faire écrire ventes/retours/ajustements dans `stock_movements` (gros chantier P3) ou assumer le scalaire + audit actuel. |
| D-E PI Stripe orphelins | job de réconciliation périodique PI capturés sans vente → alerte manager. |

## Ordre recommandé

1. **R1 + R2 + R3** (les deux P0 + le bug stock) — R2/R3 attendent chacun leur GO.
2. **R4 + R6** (intégrité sync + cohérences serveur).
3. **R5** (POS offline) puis **R9**.
4. **R7 + R8** (catalogue réel + backoffice).
5. **R10** en continu dès le départ.
6. Décisions D-A…D-E au fil de l'eau (D-A et D-C rapides).
