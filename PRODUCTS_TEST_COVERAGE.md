# PRODUCTS_TEST_COVERAGE — Couverture de tests du périmètre produits

> Audit 2026-07-10, `main` @ `5526834`. Exécution locale : **920 tests verts / 0 échec**
> (7 skipped = suites PG gated). CI (`ci.yml:19-59`) provisionne un Postgres 16 jetable et exécute
> les 5 specs `*.pg.spec.ts` avec `TEST_DATABASE_URL` → les preuves « vrai Postgres » tournent à chaque CI.

## Familles de tests

| Famille | Présence | Détail |
|---|---|---|
| Unitaires purs | ✅ | logique isolée (price-verdict, sales-trend, discount-policy POS, csv-util…) |
| Intégration pg-mem (services + repo en mémoire) | ✅ | ~30 suites — la colonne vertébrale de la preuve |
| Vrai Postgres (gated `TEST_DATABASE_URL`) | ✅ en CI | 5 suites : `sales-stock-concurrency`, `product-packs-concurrency`, `promo-codes-concurrency`, `avoir-d14-atomicity`, `fiscal-e2e` |
| E2E HTTP backend (supertest) | ⚫ | aucun (les fichiers « e2e » sont niveau service) |
| E2E front POS | 🟠 | 1 seul : `e2e/pos-smoke.spec.ts` (Playwright : login PIN → scan → total → espèces) |
| Tests UI backoffice | ⚫ | aucun composant testé (seul `catalogImport.test.ts` = assertions source-level) |
| Tests front POS (unitaires) | ✅ | 29 fichiers (idempotency, salePayload, discount-policy, posStore invariants, printHonesty, posProductCreationGuard…) |
| Tests de charge | ⚫ | aucun |
| Tests offline dédiés | 🟠 | indirects (idempotence, syncEngine/offlineStore unitaires) ; pas de scénario bout-en-bout coupure/reprise |
| Tests de migration/rollback de schéma | ⚫ | aucun (`up()/down()` jamais exécutés en test) — c'est ce qui a laissé passer l'écart `price_history` |

## Inventaire (suites → couverture)

### Produits / catalogue / packs / prix
| Spec | Type | Couvre |
|---|---|---|
| `products.service.spec.ts` | pg-mem | getStockAlerts pagination (5 cas) — **ne couvre PAS create/update/importCsv** |
| `price-verdict.spec.ts` | unit | verdict prix (7) |
| `test/product-variants.spec.ts` | pg-mem | variantes : EAN/SKU/prix propres, retour variante (4) |
| `test/product-packs.spec.ts` | pg-mem | 12 cas : CRUD composition, anti-boucle direct/indirect, doublon, vente+snapshot+hash inchangé, composant désactivé, stock insuffisant atomique, retour complet/partiel/après modification compo |
| `test/product-packs-concurrency.pg.spec.ts` | **PG (CI)** | deltas exacts vente/retour ; 10 ventes ‖ (5 passent, 0 orphelin) |
| `test/store-price-override.spec.ts` | pg-mem | override appliqué À LA VENTE, historique, négatif refusé (4) |
| `test/products-csv.spec.ts` | pg-mem | round-trip export→import, anti-injection (4) |
| `product-integration.service.spec.ts` | pg-mem | 21 cas : scan, demandes POS, PIN bcrypt, anti-doublon 409, statuts |

### Stock
| Spec | Type | Couvre |
|---|---|---|
| `stock.service.spec.ts` + `test/stock.spec.ts` | pg-mem | ajustements, seuils, alertes |
| `test/stock-locations.spec.ts` | pg-mem | réception/transfert/dispatch/pertes + gardes (9) |
| `test/stock-reconciliation.spec.ts` | pg-mem | variance ≥20 % → review, bornes 19/20/21, motif allowlist, anti-double (7) |
| `inventory-scan.idempotency.spec.ts` | pg-mem | idempotence `clientEntryId` (3) |
| `test/sales-stock-concurrency.pg.spec.ts` | **PG (CI)** | pas d'oversell/négatif sous N ventes ‖ |
| `sync.service.spec.ts` | mocks | dédup ventes par id, bornes delta — **rien sur l'idempotence stockAdjustments** |

### Vente / paiement / fiscal
`sale-transaction` (10), `sale-idempotency` (2), `sales.service.idempotency` (4), `sale-session-binding` (5), `sale-m2-hash-fingerprint`, `sales-payment-errors` (4), `card-capture-verify` (9), `payment-pending-capture`, `discount-enforcement` (5, décisif cap 30 %), `e2e-money-flow` (6, niveau service), `sales.service.audit` (3), `sales.service.store-credit` (7), `sales-guards` (3 suites), `sales-payment.dto` (4), `x-report`, `report`, `fiscal-e2e.pg` (**PG CI**), `audit-chain-verify`.

### Retours / avoirs
`returns.service.spec` (17), `create-return-request.dto.spec` (5), `avoir-d1-cash-return` (8), `avoir-d14-fiscal-seal` (3), `avoir-d14-atomicity.pg` (**PG CI**), `avoir-m1-m3` (5), `avoir-m5-chain-lock` (2), `credit-note-receipt` (4), `void-cash-realized-guard` (4), `void-m4-journal-chain` (3).

### Promotions / codes
`promotions.service.spec` (10), `test/promo.spec` (9, formules recopiées), `promo-codes.spec` (5), `promo-codes-concurrency.pg` (**PG CI**), `coupon.service.spec` (8).

### Transverse
`tenant.interceptor.spec` (~9, le vrai test d'isolation), `tenant-isolation.spec` (10 — ⚠️ patterns in-memory recodés, valeur de preuve faible), `roles.guard.spec`, `dto-validation.spec` (17, ne couvre pas les DTO produits), `money-precision.spec` (⚠️ formules ré-implémentées, pas le code réel), `csv-util.spec`.

### POS desktop (front)
`posProductCreationGuard` (invariant jamais-de-création), `posPageInlineSale`, `idempotency`, `salePayload`, `discount-policy`, `paymentMachine`, `cardPaymentMode`, `posStore` + invariants (total jamais négatif), `offlineAuthCache`, `hmacSecurity`, `printHonesty`, customerDisplay (6), e2e `pos-smoke` (Playwright).

## Niveau de preuve par fonctionnalité (P0 → P5)

| Fonctionnalité | Niveau | Justification |
|---|---|---|
| Décrément stock concurrent (2+ caisses) | **P4** | vrai PG en CI |
| Packs : vente/retour/snapshot/atomicité/concurrence | **P4** | pg-mem 12 cas + vrai PG |
| Avoirs D1.4 (scellement + atomicité) | **P4** | pg-mem + vrai PG |
| Cap codes promo sous concurrence | **P4** | vrai PG |
| Cap remise 30 % + approbateur | **P3** | discount-enforcement (décisif) |
| Capture carte vérifiée serveur | **P3** | 9 cas |
| Idempotence vente (même clé → même vente) | **P3** | 2 suites |
| Prix magasin appliqué à la vente | **P3** (test) / **P0 en prod** | fonctionne en test (synchronize) ; **casse en prod** — écart migration `price_history` jamais détectable par les tests actuels |
| Hash chain v2 / immutabilité void | **P3** | m2/m4 specs |
| Isolation multi-tenant | **P3** | interceptor spec + scoping services (indirect) |
| Réconciliation inventaire ≥20 % | **P3** | bornes testées |
| Import/export CSV | **P3** (round-trip) / **P0** (gros volumes, séparateur `;`, backend `importCsv` sans test direct) |
| Création/modification produit (service backend) | **P1** | aucun test unitaire de `create()`/`update()` |
| Création/modification produit (écran backoffice) | **P0** | cassé, aucun test UI |
| Cumul override+promo+remise+code | **P1** | jamais testé ensemble |
| Sync offline stockAdjustments | **P0** | faille d'idempotence, aucun test |
| `/sync/push` ventes (hash/ticket/stock) | **P1** | dédup testée, intégrité non testée |
| Void d'une vente pack (composants) | **P0** | bug, aucun test |
| Scan POS (douchette réelle, UPC/EAN, latence) | **P2/P4 partiel** | e2e smoke un chemin ; pas de normalisation testée |
| Vente offline → sync (bout-en-bout réel) | **P2** | unités POS + dédup serveur ; pas de scénario E2E coupure/reprise |
| Migrations (up/down, écarts schéma) | **P0** | aucun test — cause racine du G2 |

## Recommandations de couverture (sans code, pour la roadmap)

1. **Test d'écart schéma** : un spec PG (CI) qui exécute toutes les migrations puis compare le schéma
   obtenu aux métadonnées TypeORM des entités — aurait attrapé `price_history` (G2) et attrapera les suivants.
2. Tests unitaires `ProductsService.create/update/importCsv` + `csv.util`.
3. Test void+pack (restauration composants) — rouge aujourd'hui, à écrire AVANT le fix (tests-as-spec).
4. Test d'idempotence `sync.push stockAdjustments` (rejeu du même payload → une seule application).
5. Test d'intégration cumul des 4 mécanismes de remise dans `createSale`.
6. Test E2E HTTP minimal (supertest) : créer produit → vendre → retourner, avec ValidationPipe réel —
   aurait attrapé G1 (payload backoffice) si doublé d'un test de contrat front.
