# EXECUTION_LOG.md — Journal d'exécution par paquets

> Append-only. Chaque paquet : blocs, avant/après, fichiers, routes, intégrations, tests lancés + résultats, risques, stubs, commit, paquet suivant.

---

## PAQUET 1 — Gouvernance & Audit (2026-06-28)

**Blocs traités** : POS-001, POS-002, POS-003, POS-004, POS-005.

| Bloc | Avant | Après |
|---|---|---|
| POS-001 Audit read-only | ⬜ | ✅ (faits vérifiés par commandes, `PROJECT_STATUS.md`) |
| POS-002 12 fichiers pilotage | ⬜ (0/12 existants) | ✅ (12/12 créés) |
| POS-003 Registre blocs | ⬜ | ✅ (`POS_BLOCKS.md`, ~POS-001→133) |
| POS-004 Aligner CLAUDE.md | ⬜ | ✅ (counts 40/47/16/~488/66, note modules) |
| POS-005 Cadence/journal | ⬜ | ✅ (ce fichier) |

**Fichiers créés** : `MASTER_ROADMAP.md`, `PROJECT_STATUS.md`, `POS_BLOCKS.md`, `POS_ARCHITECTURE.md`, `POS_API_MAP.md`, `POS_INTEGRATIONS.md`, `POS_OFFLINE_STRATEGY.md`, `POS_PAYMENT_STRATEGY.md`, `POS_SECURITY.md`, `POS_TEST_PLAN.md`, `TECHNICAL_DEBT.md`, `EXECUTION_LOG.md`.
**Fichiers modifiés** : `CLAUDE.md` (5 éditions ciblées : date + 4 counts).

**Routes/API touchées** : aucune (gouvernance documentaire uniquement).
**Intégrations vérifiées** : inventaire (voir `POS_INTEGRATIONS.md`). Paywin24 ⛔, Comptamax24 ⛔, cockpit mobile alerts ⛔ — confirmés absents du code.

**Tests lancés** :
- `npm rebuild bcrypt` (Linux) — OK, requis avant tout test dans le sandbox.
- `jest --testPathPattern money` → **9/9 PASS**.
- Suite complète : **non terminée** dans une fenêtre de 45 s (coût ts-jest). Pas de FAIL observé dans le streaming partiel.
- (Voir résultats specs P0 invariants ajoutés ci-dessous après exécution.)

**Résultat** : gouvernance posée, drift documentaire corrigé, registre prêt.

**Risques restants** : suite complète non confirmée verte ici (`TD-FULL-SUITE-CI`) ; points sécurité avril `À vérifier`.
**Stubs/placeholders identifiés** : Paywin24, Comptamax24, `/api/mobile/v1/alerts`, exports compta.

**Commit** : (voir hash ajouté après `git commit` — `docs(governance): audit + 12 pilotage files + block registry`).

**Prochain paquet** : PAQUET 2 ci-dessous.

---

## PAQUET 2 — Vérification invariants P0 (2026-06-28)

**Méthode choisie par l'utilisateur** : specs ciblés un par un. Constat honnête : le sandbox ne peut **pas** compiler/exécuter un seul spec du graphe `sales` en < 45 s (même avec `isolatedModules` + cache chaud). → Bascule en **revue de code** (PAS exécution de test), commandes locales fournies.

**Blocs traités** : POS-047, POS-048, POS-052, POS-054, POS-120.

| Bloc | Résultat (revue de code) | Preuve |
|---|---|---|
| POS-047 Idempotence | ✅ code conforme | `sales.service.ts` replay L176-184, in-tx L350-355, persist même tx L509-519, expiry 7j, ConflictException |
| POS-048 Paiement ≥ total | ✅ code conforme (sémantique ≥, monnaie rendue OK) | L311-320 + cap avoir L324-336 |
| POS-052 Garde void cash | ✅ code conforme | voidSale L948-965 `cashRealized`→Conflict + limite manager 500€ |
| POS-054 Plafond remise 30% | ⛔ **ÉCART RÉEL** | L290 `maxDiscount` par employé (défaut 100), pas de plafond absolu 30% ; guard 20% molle. `TD-DISCOUNT-CAP` |
| POS-120 Hash-chain fiscale | ✅ code conforme | `fiscal-verify.service.ts` 3 chaînes par pointeurs hash ; `npm run fiscal:verify` |

**Tests lancés** : tentatives `jest` par spec (idempotency) → **non terminées en 44 s** (limite sandbox, pas un échec projet). Aucun test déclaré "passé" pour ces blocs. **À exécuter localement** :
```
cd packages/backend && npx jest sales.service.idempotency.spec sales.service.audit.spec sales.service.store-credit.spec
npm run fiscal:verify   # vérif chaîne fiscale (read-only)
```

**Fichiers modifiés** : `POS_BLOCKS.md` (statuts P0), `TECHNICAL_DEBT.md` (+`TD-DISCOUNT-CAP`), ce journal. **Aucun code métier modifié** (revue uniquement — l'écart POS-054 touche la logique remise/argent et exige une décision produit avant correction).

**Risque bloquant identifié** : POS-054. Le plafond "30% max, jamais plus" n'est pas garanti. Correction = changement de comportement monétaire → nécessite décision produit (le 30% est-il un plafond dur écrasant la config employé ?) + tests dédiés. **Non corrigé sans validation.**

**Prochain paquet** : PAQUET 3 ci-dessous.

---

## PAQUET 3 — POS-054 Politique de remise (2026-06-28)

**Décision produit reçue** (séparation stricte caisse / back-office) :
- **Caisse** : plafond dur 30% (même avec code responsable) ; code responsable obligatoire pour toute remise manuelle ; justification écrite obligatoire de 21% à 30% (non vide, non générique) ; tentative > 30% refusée et auditée.
- **Back-office/central** : jusqu'à 100%, rôles admin/centraux uniquement, jamais depuis terminal, motif + validateur + audit obligatoires au-delà de 30%.

**Constat code** : les remises actuelles sont **uniquement promo** (`applyPromos`) ; `CreateSaleDto` n'a **aucun** champ remise manuelle / code responsable / justification. POS-054 est donc une **fonctionnalité neuve** (pas un simple plafond — clamper les promos casserait les promotions légitimes type first-purchase).

**Réalisé & VÉRIFIÉ** :
- `src/modules/sales/discount-policy.ts` — moteur **pur** (sans DB/Nest) implémentant toute la règle.
- `src/modules/sales/discount-policy.spec.ts` — matrice produit complète.
- **Test exécuté dans le sandbox : `discount-policy.spec` → 14/14 PASS** (résultat réel, pas une affirmation).

**Non fait (scindé en blocs, NON déclaré branché)** :
- POS-054b câblage `createSale` + champs DTO (changement monétaire → à tester localement).
- POS-054c source de vérification du code responsable.
- POS-054d colonnes entité + migration + persistance audit remise.
- POS-054e endpoint remise back-office.

**Pourquoi non câblé maintenant** : le câblage modifie la répartition remise/lignes/TVA ; le gros test de vente ne tourne pas dans le sandbox (cap 45 s). Refus de déclarer « branché/testé » sans preuve.

**Tests** : `npx jest --config <fast> discount-policy.spec` → 14/14 (vérifié). Suite vente complète : à lancer localement après POS-054b.

**Fichiers** : +`discount-policy.ts`, +`discount-policy.spec.ts` ; MAJ `POS_BLOCKS.md`, `TECHNICAL_DEBT.md`, ce journal. **Aucune logique de vente existante modifiée.**

**Commit** : git sandbox bloqué (`.git/index.lock` non supprimable, dossier monté). À committer localement :
```
git add packages/backend/src/modules/sales/discount-policy.ts packages/backend/src/modules/sales/discount-policy.spec.ts \
        POS_BLOCKS.md TECHNICAL_DEBT.md EXECUTION_LOG.md
git commit -m "feat(sales): POS-054 discount policy engine (pure, 14/14 tests) + block split for wiring"
```

**Prochain paquet** : PAQUET 4 ci-dessous.

---

## PAQUET 4 — POS-054b/c/d/e câblage remise (2026-06-28)

**Blocs** : BLOC 001 (POS-054b), BLOC 002 (POS-054c), BLOC 003 (POS-054d), BLOC 004 (POS-054e), BLOC 005 (tests/docs).

| Bloc | État | Preuve |
|---|---|---|
| 001 POS-054b câblage caisse | ✅ codé+branché, **tsc clean** ; runtime à tester local | `sales.service.ts` bloc manuel + distribution lignes ; `sales.dto.ts` 3 champs ; promos non touchées |
| 002 POS-054c code responsable | ✅ branché réel | `verifyResponsablePin` (PIN manager/admin bcrypt). Dette rate-limit `TD-RESP-PIN` |
| 003 POS-054d audit remise | ✅ branché append-only | `auditService.log` `manual_discount_applied` / `manual_discount_blocked`. Pas de migration (audit_entry). Terminal id manquant `TD-054D-TERMINAL` |
| 004 POS-054e back-office | ✅ codé+branché+**testé 5/5** | module `backoffice-discounts`, `POST /api/backoffice/discounts/authorize` admin-only |
| 005 tests + docs | ✅ | specs purs exécutés, docs MAJ |

**Tests réellement exécutés (sandbox)** :
- `discount-policy.spec` + `backoffice-discount.service.spec` → **25/25 PASS** (config ts-jest `isolatedModules`).
- `tsc --noEmit -p tsconfig.json` → **EXIT 0** (backend compile, câblage type-correct). 1 erreur trouvée puis corrigée (`AuditService.log` exige `entityId`).
- ⚠️ **NON exécuté** : suite vente lourde (`sales.service.*.spec`) — dépasse 45 s sandbox. Le câblage runtime de `createSale` est donc **branché + compilé**, pas **testé runtime ici** → `TD-054B-RUNTIME`. À lancer localement :
  ```
  cd packages/backend && npm run test:backend
  ```

**Fichiers créés** : `backoffice-discounts/{service,controller,module,dto,spec}` (5).
**Fichiers modifiés** : `discount-policy.ts` (+distribution), `discount-policy.spec.ts` (+6 tests), `sales.service.ts` (DTO local + injection EmployeeEntity + bloc manuel + 2 méthodes privées + audit post-commit), `sales.module.ts` (EmployeeEntity), `common/dto/sales.dto.ts` (3 champs), `app.module.ts` (BackofficeDiscountModule), docs.

**Séparation caisse/back-office (vérifiée par design)** : caisse = `createSale` channel `pos` (plafond dur 30%) ; back-office = endpoint admin séparé channel `backoffice` (≤100%). 100% impossible depuis la caisse.

**Honnêteté** : Paywin24, Comptamax24, cockpit `mobile/v1/alerts` restent **non branchés**. Aucune conformité fiscale/DSN déclarée. Aucun dépôt live Stripe.

**Git** : `.git/index.lock` toujours non supprimable dans le sandbox. Commits PAQUET 2/3/4 à faire localement (voir commande ci-dessous).

**Prochain paquet** : PAQUET 5 ci-dessous.

---

## PAQUET 5 — Stock (audit + helpers) (2026-06-28)

**Blocs** : POS-080, POS-081, POS-082, POS-083, POS-066.

| Bloc | État | Preuve |
|---|---|---|
| POS-080 stock par magasin | ✅ vérifié | `product.stockQuantity` + index unique `(ean,storeId)` |
| POS-081 mouvement à la vente | ⚠️ ÉCART | `createSale` L596 décrément SQL brut, **pas** de `stock_movement` ni alerte → `TD-081-MOVEMENT` |
| POS-082 retour stock | 🟡 partiel | restock OK (`returns` L189) mais pas de `stock_movement` → `TD-082-MOVEMENT` |
| POS-083 alerte 20% | ⛔ décision produit | seuils absolus, pas de baseline → `TD-083-BASELINE`. Helpers fournis ; `crossedDownward` branché dans `decrementStock` |
| POS-066 anti-doublon | 🟡 (EAN/nom OK, SKU n/a) | index unique EAN + dédup nom ; pas de SKU → `TD-066-SKU` |

**Réalisé & VÉRIFIÉ** :
- `stock/stock-level.ts` (`classifyStockLevel`, `crossedDownward`, `relativeThreshold`) + `stock-level.spec.ts` → **7/7 PASS** (exécuté).
- Refactor **behavior-preserving** de `decrementStock` (utilise `crossedDownward`).
- `tsc --noEmit` backend → **EXIT 0** (clean).

**Non fait (honnête, blocs/dette)** :
- Journalisation `stock_movement` à la vente/au retour (`TD-081/082-MOVEMENT`) — touche la transaction `createSale`/`returns`, non testable runtime ici.
- Alerte stock sur la voie vente : `createSale` n'appelle pas `stockService` → les alertes ne se déclenchent pas en vente normale.
- `relativeThreshold` (20%) **non branché** : baseline indéfini (décision produit `TD-083-BASELINE`).

**Tests exécutés (sandbox)** : `stock-level.spec` 7/7 ; cumul specs purs remise+stock confirmés verts. `tsc` clean. Suite stock lourde (`stock.service.spec`) **non exécutée** (graphe Nest/DB > 45 s) → à lancer en local.

**Fichiers** : +`stock/stock-level.ts`, +`stock/stock-level.spec.ts` ; modifié `stock/stock.service.ts` (import + 2 conditions via helper) ; docs.

**Décision produit requise (POS-083)** : définir la baseline du seuil 20% (stock initial ? par level ? max ? point de réappro ?). Sans elle, l'alerte relative ne peut être branchée honnêtement.

**Git** : `.git/index.lock` toujours bloqué dans le sandbox → commit local (commande inchangée, ajouter `packages/backend/src/modules/stock`).

**Prochain paquet** : PAQUET 6 ci-dessous.

---

## PAQUET 6 — POS-083a alerte stock relative 20% (2026-06-28)

**Décision produit reçue** : « 20% d'un par/max à ajouter ».

**Réalisé & VÉRIFIÉ** :
- Entité `product.stockBaselineQuantity` (nullable, type explicite — règle TypeORM).
- Migration **réversible & documentée** `1721000000000-AddStockBaseline` (ADD COLUMN IF NOT EXISTS / down DROP). Additive/nullable → aucun impact sur l'existant (fallback seuil absolu).
- `effectiveAlertThreshold(baseline, absolu, 20)` + tests → `stock-level.spec` **9/9 PASS**.
- Branché : `getAlerts` (SQL `COALESCE(CEIL(baseline*0.2), stock_alert_threshold)`) + `decrementStock` (alerte + audit `baselineQuantity`).
- `tsc --noEmit` backend → **EXIT 0**.

**Honnête** :
- ⚠️ Migration **non exécutée** ici (pas de DB prod/sandbox ; interdiction prod). À lancer en dev/local : `npm run migration:run`.
- ⚠️ Test runtime de `getAlerts`/`decrementStock` (graphe DB) **non exécuté** (> 45 s sandbox) → local.
- Les alertes ne se déclenchent toujours pas sur la **voie vente** (`createSale` n'appelle pas `stockService` — POS-081/`TD-081-MOVEMENT`).
- `baselineQuantity` doit être **saisie** par produit (UI back-office) pour activer le relatif ; sinon comportement absolu inchangé.

**Fichiers** : +migration `1721000000000`, modifié `product.entity.ts`, `stock/stock-level.ts` (+helper), `stock/stock-level.spec.ts` (+2 tests), `stock/stock.service.ts` (getAlerts+decrementStock), `CLAUDE.md` (migrations 16→17 + liste), `POS_BLOCKS.md`, `TECHNICAL_DEBT.md`.

**Prochain paquet** : PAQUET 7 ci-dessous.

---

## PAQUET 7 — Caisse (comptage) + GATE stock (2026-06-28)

> Pilotage : skill **Cowork Continuation Controller** actif. Continuité auto ; classification du risque sur le fond ; preuve exigée sur tout résultat vérifiable.

**Blocs** : POS-081/082 (GATE archi), POS-016, POS-017, POS-017b (scoped).

### GATE architecture — POS-081/082 (non exécuté, à raison)
Audit `stock_movements` : journal canonique **location-keyed** (`from/to_location_id` → `stock_locations`), alimenté seulement par `stock-locations`. `createSale`/`returns` opèrent sur `products.stockQuantity` **store-keyed**. Le commentaire « sales auto-created by SalesService » est **faux**. Brancher le journal à la vente = unifier deux systèmes = **décision d'architecture non tranchée → STOP DUR** (`TD-STOCK-TWO-SYSTEMS`).

**Dossier (pour décision humaine)** :
- Contexte : 2 systèmes stock parallèles, non reliés.
- Impact : pas de journal de mouvement immuable à la vente (traçabilité partielle).
- Alternatives réversibles : (A) résoudre/auto-créer une `stock_location` par magasin et écrire un mouvement `sale`/`return_customer` dans la transaction ; (B) tracer les mouvements vente via `audit_entry` (déjà en place) sans toucher `stock_locations` ; (C) migrer entièrement `products.stockQuantity` vers `stock_balance` (lourd).
- Rollback : A/B additifs et réversibles ; C non.
- **Aucune action sans GO sur l'option.**

### Réalisé & VÉRIFIÉ
- `pos-session/cash-count.ts` (`countCash`, `reconcileCash` : expected=float+ventes cash−remboursements, variance, status balanced/over/short, tolérance) + spec → **8/8 PASS** (exécuté).
- `tsc --noEmit` backend → **EXIT 0**.

### Audit (honnête)
- POS-016 : open/close session terminal-bound présents (`pos-session`) ; **pas de fond de caisse** ni lien session↔ventes → 🟡.
- POS-017 : **cœur de réconciliation testé** ; persistance/endpoints (POS-017b) à faire ; bloqué en amont par `TD-017-SESSION-LINK` (pas de `pos_session_id` sur `sale`).

**Fichiers** : +`pos-session/cash-count.ts`, +`cash-count.spec.ts` ; MAJ `POS_BLOCKS.md`, `TECHNICAL_DEBT.md` (+TD-STOCK-TWO-SYSTEMS, +TD-017-SESSION-LINK), ce journal.

**Tests exécutés cumul session** : remise 20/20 + back-office 5/5 + stock 9/9 + cash-count 8/8 = **42 PASS** ; `tsc` clean à chaque paquet.

**Git** : `.git/index.lock` toujours bloqué (sandbox) → commit local. Ajouter `packages/backend/src/modules/pos-session`.

**Prochain paquet** : PAQUET 8 ci-dessous.

---

## PAQUET 8 — Historique ventes + politique promo (2026-06-28)

**Blocs** : BLOC 001 POS-018, BLOC 002 POS-073.

### BLOC 001 — POS-018 historique ventes
- `findByStore` + controller : filtres **optionnels additifs** `employeeId`, `from`, `to`, `status` (rétro-compatible). Conserve page/limit/date + admin cross-store.
- `tsc --noEmit` → **EXIT 0**. ⚠️ runtime DB non exécuté ici → local (`TD-018-FILTERS-RUNTIME`).

### BLOC 002 — POS-073 refus promo
- Audit : expirée ✅ (`getActivePromos`) ; plafond usage ❌ (pas de champ → `TD-073-USAGE-LIMIT`) ; cumul/doublon ❌ (`applyPromos` ne dé-cumule pas → `TD-073-STACKING`). Coupons idempotents (séparé).
- Livré : `promotions/promo-policy.ts` (`isPromoActive`, `dedupeBestPerProduct`) + spec. **Non branché** dans `applyPromos` (money path → runtime local).

**Tests exécutés (sandbox)** : 5 suites pures → **50/50 PASS** (discount 20 + back-office 5 + stock 9 + cash-count 8 + promo 8). `tsc` clean.

**Fichiers** : modifié `sales.service.ts`, `sales.controller.ts` ; +`promo-policy.ts`, +`promo-policy.spec.ts` ; MAJ docs.

**Git** : `.git/index.lock` bloqué (sandbox) → commit local.

**Prochain paquet** : PAQUET 9 ci-dessous.

---

## PAQUET 9 — Cockpit mobile alertes (POS-110/111/112/113) (2026-06-28)

**Sécurité (classée sur le fond)** : la garde customer `MobileAuthGuard` exposerait les alertes magasin aux clients → **refusé**. Endpoint gardé par **JWT employé + RolesGuard `@Roles('manager')`**, tenant-scoped, **lecture seule**.

**Réalisé & VÉRIFIÉ** :
- Nouveau module `mobile-cockpit` : `GET /api/mobile/v1/alerts` → agrège `stockService.getAlerts` (alert/critical) + `sale_anomaly_logs` (status `detected`).
- Shaper pur `cockpit.ts` (`buildAlertsCockpit` : résumé + overall ok/warning/critical) + spec → **6/6 PASS** (exécuté).
- `tsc --noEmit` backend → **EXIT 0** (module/service/controller + app.module compilent).

**Couverture POS** :
- POS-111 endpoint ✅ créé (runtime DB local) ; POS-113 lecture seule ✅ ; POS-110 backend ✅ (UI mobile à faire) ; POS-112 stock+anomalies ✅, paiement/fermeture ❌ (`TD-112-MORE-ALERTS`).
- `TD-MOBILE-COCKPIT` → résolu (implémenté).

**Fichiers** : +`mobile-cockpit/{cockpit.ts,cockpit.spec.ts,service,controller,module}` ; MAJ `app.module.ts`, `CLAUDE.md` (42 modules), `PROJECT_STATUS.md`, `POS_BLOCKS.md`, `TECHNICAL_DEBT.md`.

**Tests cumul session** : 6 suites pures → **56/56 PASS** (discount 20 + back-office 5 + stock 9 + cash-count 8 + promo 8 + cockpit 6). `tsc` clean.

**Honnête** : runtime DB non exécuté (sandbox) ; Paywin24 / Comptamax24 toujours non branchés ; alertes paiement/fermeture non encore agrégées.

**Git** : `.git/index.lock` bloqué (sandbox) → commit local.

**Prochain paquet** : PAQUET 10 ci-dessous.

---

## PAQUET 10 — Anti-cumul promo branché & prouvé (POS-073) (2026-06-28)

**Réalisé & VÉRIFIÉ RUNTIME (pas seulement code review)** :
- `applyPromos` retourne désormais `dedupeBestPerProduct(results)` → **anti-cumul** : au plus 1 promo (la plus forte) par produit. Les promotions légitimes (1 promo/produit, produits différents) inchangées.
- `promotions.service.spec.ts` : +1 test anti-stacking → **11/11 PASS** (le spec utilise un repo mocké, **exécutable dans le sandbox** — donc câblage réellement testé ici).
- `tsc --noEmit` → **EXIT 0**.
- `TD-073-STACKING` → **résolu** (branché + testé).

**Reste ouvert** : `TD-073-USAGE-LIMIT` (plafond d'usage — nécessite champ + migration).

**Fichiers** : `promotions.service.ts` (import + return dedupe), `promotions.service.spec.ts` (+test) ; MAJ `POS_BLOCKS.md`, `TECHNICAL_DEBT.md`, ce journal.

**Tests cumul session** : pures 56/56 + `promotions.service.spec` 11/11 + `promo.spec`/`stock.service` non relancés ici. Total prouvé cette session ≥ **67 PASS**. `tsc` clean.

**Note importante** : ce paquet montre qu'un sous-ensemble de specs **à repo mocké** (promotions.service, backoffice, helpers purs) **tourne dans le sandbox** ; seules les specs qui bootent pg-mem + tout le graphe (sales/fiscal) dépassent 45 s. Les prochains câblages seront priorisés vers des zones à specs mockés exécutables ici.

**Git** : `.git/index.lock` bloqué (sandbox) → commit local.

**Prochain paquet** : PAQUET 11 ci-dessous.

---

## SÉCURISATION GIT (2026-06-28)

`.git/index.lock` + `.git/HEAD.lock` + ref lock = résiduels, **non supprimables** (mount FUSE, tenus par l'app desktop). Ref updates impossibles depuis le sandbox.
- **Objet commit durable** `a6b7cc8` (parent `c55e6c5`) = paquets 2→10 (dangling, non référencé).
- **Patch** `_BACKUP_PAQUET_2-10.patch` (194 KB) dans le workspace + outputs.
- Procédure complète : `GIT_RECOVERY.md`. PAQUET 11 lancé seulement après cette sécurisation.

---

## PAQUET 11 — Couverture règles promo (POS-070/071/072) (2026-06-28)

**Réalisé & VÉRIFIÉ RUNTIME** :
- Validité (POS-070) : `isPromoActive` testé ; `getActivePromos` filtre start/end.
- Scope (POS-071) : +2 tests dans `promotions.service.spec` — promo **catégorie** appliquée seulement aux items de la catégorie ; promo **produit** non appliquée hors-portée. → **13/13 PASS** (exécuté sandbox).
- Aucun changement de comportement (logique `isPromoApplicable` déjà correcte) — **durcissement de tests** uniquement.

**Reste** : POS-071 limite d'usage ❌ (`TD-073-USAGE-LIMIT`, champ+migration).

**Fichiers** : `promotions.service.spec.ts` (+2 tests) ; MAJ `POS_BLOCKS.md`, ce journal.

**Tests cumul session** : helpers purs 56/56 + `promotions.service.spec` **13/13** + autres specs mockés. `tsc` clean (inchangé).

**Git** : ref toujours bloquée ; backup rafraîchi (nouvel objet commit + patch régénérés).

**Prochain paquet** : PAQUET 12 ci-dessous.

---

## PAQUET 12 — Validation paiements (POS-040/043/044/048) (2026-06-28)

**Réalisé & VÉRIFIÉ** :
- Extraction de la validation paiement de `createSale` → `sales/payment-policy.ts` (`validatePayments`, pur) : couverture (≥), **monnaie rendue** (`changeMinorUnits`), **cap avoir résiduel** (no value destruction). Messages **identiques** à l'existant.
- `createSale` appelle le helper et mappe `PaymentPolicyViolation`→`BadRequestException` → **comportement préservé**.
- `payment-policy.spec` → **7/7 PASS** (exact, surpaiement/monnaie, insuffisant, mixte cash+card, avoir ≤ résiduel, avoir > résiduel refusé, avoir seul).
- `tsc --noEmit` → **EXIT 0**.

**Couverture** : POS-040 espèces+monnaie ✅, POS-043 avoir ✅, POS-044 mixtes ✅, POS-048 cohérence ✅ (tous testés).

**Honnête** : la suite **lourde** `sale-transaction`/`e2e` n'est pas exécutable ici (>45 s) ; comme messages+type d'exception sont identiques, le comportement HTTP est inchangé — **à reconfirmer en local** (`npm run test:backend`).

**Fichiers** : +`sales/payment-policy.ts`, +`payment-policy.spec.ts` ; modifié `sales.service.ts` (import + bloc remplacé) ; MAJ `POS_BLOCKS.md`, ce journal.

**Tests cumul session** : helpers/specs mockés exécutés ≥ **76 PASS** (56 purs + 13 promo svc + 7 payment). `tsc` clean.

**Git** : ref toujours bloquée (sandbox) ; backup régénéré.

**Prochain paquet** : PAQUET 13 ci-dessous.

---

## PAQUET 13 — Remboursement / retours (POS-045/046) (2026-06-28)

**Réalisé & VÉRIFIÉ RUNTIME** :
- Extraction de la math refund de `returns.service` → `returns/returns-policy.ts` (`returnableQuantity`, `computeLineRefund` proportionnel au net, jamais plus que payé). Comportement préservé.
- `returns-policy.spec` → **7/7** ; **régression** `returns.service.spec` → **17/17 PASS** (le câblage ne casse rien — prouvé en sandbox).
- `tsc --noEmit` → **EXIT 0**.

**Couverture** : POS-046 remboursement ✅ (math testée + service vert) ; POS-045 annulation ✅ (garde void cash, cf POS-052) ; POS-082 restock (déjà 🟡, journal mouvement = `TD-082-MOVEMENT`).

**Fichiers** : +`returns/returns-policy.ts`, +`returns-policy.spec.ts` ; modifié `returns.service.ts` (import + 2 lignes) ; MAJ `POS_BLOCKS.md`, ce journal.

**Tests cumul session** : ≥ **83 PASS** (76 + 7 returns-policy ; régression returns.service 17/17 incluse). `tsc` clean.

**Git** : ref bloquée (sandbox) ; backup régénéré.

**Prochain paquet** : PAQUET 14 ci-dessous.

---

## PAQUET 14 — Employés rôles/permissions + binding (POS-090/091) (2026-06-28)

**Réalisé & VÉRIFIÉ** :
- Extraction de la hiérarchie de rôles de `RolesGuard` → `common/guards/role-hierarchy.ts` (`roleLevel`, `roleSatisfies`), **sémantique identique** (admin>manager>cashier ; rôle inconnu requis → jamais satisfait).
- `RolesGuard` refactoré pour l'utiliser → **comportement préservé**.
- `role-hierarchy.spec` → **9/9 PASS** (héritage, rôle inconnu user/required, multi-rôles, liste vide).
- `tsc --noEmit` → **EXIT 0**.

**Couverture** : POS-090 ✅ (hiérarchie testée + employees CRUD/PIN existants) ; POS-091 ✅ (session porte `employeeId`+`terminalId`, 1 active/(store,terminal) ; `employee-store-access`).

**Honnête** : `auth-security.spec` (lourde) non exécutée ici (>45 s) ; sémantique identique → guard inchangé, à reconfirmer local.

**Fichiers** : +`role-hierarchy.ts`, +`role-hierarchy.spec.ts` ; modifié `roles.guard.ts` ; MAJ `POS_BLOCKS.md`, ce journal.

**Tests cumul session** : ≥ **92 PASS** (83 + 9 role-hierarchy ; régressions promo 13/13 + returns 17/17 incluses ailleurs). `tsc` clean.

**Git** : ref bloquée (sandbox) ; backup régénéré.

**Prochain paquet** : PAQUET 15 ci-dessous.

---

## PAQUET 15 — TVA / TTC (POS-063) (2026-06-28)

**Réalisé & VÉRIFIÉ** :
- Extraction TVA de `createSale` → `sales/tax.ts` (`extractLineTax` = round(gross×rate/(100+rate)), `sumLineTax`). **Formule identique** à l'inline → liée au hash fiscal (hash-safe).
- `tax.spec` → **6/6 PASS**, dont un **test-propriété** comparant le helper à la formule inline sur une plage (gross 0→5000, rates 0/5.5/10/20) → câblage behavior-preserving prouvé.
- `createSale` branché sur `sumLineTax`. `tsc --noEmit` → **EXIT 0**.

**Découverte** : `shared/utils/money.ts#extractTax` utilise un arrondi **net-first** différent → peut différer de 1 centime. **Non unifié** (toucherait le hash fiscal) → `TD-TAX-DUP` (décision fiscale).

**Fichiers** : +`sales/tax.ts`, +`tax.spec.ts` ; modifié `sales.service.ts` (boucle TVA → `sumLineTax`) ; MAJ `POS_BLOCKS.md`, `TECHNICAL_DEBT.md`, ce journal.

**Tests cumul session** : 10 suites helpers → **85 PASS** (79 + 6 tax). `tsc` clean.

**Git** : ref bloquée (sandbox) ; backup régénéré.

**Prochain paquet** : PAQUET 16 ci-dessous.

---

## PAQUET 16 — Audit hash-chain (POS-056) (2026-06-28)

**Réalisé & VÉRIFIÉ RUNTIME** :
- Extraction des primitives hash de `audit.service` → `audit/audit-hash.ts` (`GENESIS_HASH`, `sha256`, `computeAuditHash`) + nouveau **`verifyAuditChain`** (linkage + intégrité, oldest→newest). Formule identique → comportement préservé.
- `audit.service` refactoré pour importer le module (suppression du code dupliqué en-fichier).
- `audit-hash.spec` → **8/8** (déterminisme, indépendance ordre des clés, sensibilité prev/data, détection lien cassé + données altérées) ; **régression** `audit.controller.spec` → **6/6** (refactor service OK).
- `tsc --noEmit` → **EXIT 0**.

**Découverte** : `shared/utils/hash.ts#createAuditHash` est une copie équivalente non importée par le backend → `TD-AUDIT-HASH-DUP` (unification = décision build, non faite).

**Couverture** : POS-056 ✅ (primitives + verifier testés ; entité append-only) ; complète POS-120/124 (vérificateur fiscal existant).

**Fichiers** : +`audit/audit-hash.ts`, +`audit-hash.spec.ts` ; modifié `audit.service.ts` (imports) ; MAJ `POS_BLOCKS.md`, `TECHNICAL_DEBT.md`, ce journal.

**Tests cumul session** : 11 suites helpers → **93 PASS** (85 + 8 audit-hash) + régressions services (audit.controller 6/6, promotions 13/13, returns 17/17). `tsc` clean.

**Git** : ref bloquée (sandbox) ; backup régénéré.

**Prochain paquet** : PAQUET 17 ci-dessous.

---

## PAQUET 17 — Catalogue anti-doublon nom (POS-066) (2026-06-28)

**Audit** : dédup produit = index unique EAN `(ean,storeId)` ; dédup nom existe seulement pour **catégories** (`createCategory`, `LOWER()=LOWER()`, SQL). Pas de normalisation accents.

**Réalisé & VÉRIFIÉ** :
- `products/name-normalize.ts` (`normalizeName` : NFD + strip accents + lowercase + trim + collapse ; `isDuplicateName`) + spec → **6/6 PASS** ("Café"→"cafe", "Crème brûlée"→"creme brulee", variantes espaces/casse).
- `tsc --noEmit` → **EXIT 0**.
- **Non branché** dans la dédup SQL (accent-insensible = changement comportement → décision produit) → `TD-066-NAME-WIRING`. Foundation prête.

**Fichiers** : +`products/name-normalize.ts`, +`name-normalize.spec.ts` ; MAJ `POS_BLOCKS.md`, `TECHNICAL_DEBT.md`, ce journal.

**Tests cumul session** : 12 suites helpers → **99 PASS** (93 + 6). `tsc` clean.

**Git** : ref bloquée (sandbox) ; backup régénéré.

**Prochain paquet** : PAQUET 18 ci-dessous.

---

## PAQUET 18 — Coupons + audit prix magasin (POS-070/061) (2026-06-28)

**Audit POS-061** : le prix par magasin **existe déjà** (produit scopé `storeId`, unique `(ean,storeId)`) ; le mécanisme **base+override** n'existe pas (`product-store-availability` = statut highlight only) → feature future `TD-061-OVERRIDE`. Pas de code (décision/feature).

**Réalisé & VÉRIFIÉ RUNTIME (POS-070 coupons)** :
- Extraction des prédicats de `coupon.service.redeem` → `coupon/coupon-policy.ts` (`isValidIdempotencyKey`, `isCouponAvailable`, `isCouponExpired`, `cooldownEnd`, `isInCooldown`). Comportement préservé.
- `coupon.service` refactoré pour les utiliser (idempotency-key, dispo, expiry, cooldown).
- `coupon-policy.spec` → **7/7** ; **régression** `coupon.service.spec` → **6/6 PASS**.
- `tsc --noEmit` → **EXIT 0**.

**Fichiers** : +`coupon/coupon-policy.ts`, +`coupon-policy.spec.ts` ; modifié `coupon.service.ts` (imports + 3 blocs) ; MAJ `POS_BLOCKS.md`, `TECHNICAL_DEBT.md`, ce journal.

**Tests cumul session** : 13 suites helpers → **106 PASS** (99 + 7). Régressions services cumulées : coupon 6/6, audit 6/6, promotions 13/13, returns 17/17. `tsc` clean.

**Git** : ref bloquée (sandbox) ; backup régénéré.

**Prochain paquet** : PAQUET 19 ci-dessous.

---

## PAQUET 19 — Catalogue : dédup nom (POS-066) + override prix magasin (POS-061) — BLOCS 19→23 (2026-06-28)

Décisions produit tranchées par l'utilisateur. 5 blocs enchaînés.

### BLOC 19 — POS-066 colonne normalisée
- Entité `product.normalizedName` (nullable, type explicite) + migration **réversible** `1722-AddProductNormalizedName` (ADD COLUMN IF NOT EXISTS + backfill `lower(trim(name))` + index `(store_id, normalized_name)` ; down DROP).

### BLOC 20 — POS-066 câblage dédup
- `products.service.create` : refus si `normalizeName(name)` existe déjà dans le magasin (`ConflictException`) ; set `normalized_name` ; sync sur `update`.
- `products.service.spec` : +2 tests dédup → **7/7 PASS** (refus doublon "CAFE"/"Café" ; création stocke "creme brulee"). `TD-066-NAME-WIRING` résolu.

### BLOC 21 — POS-061 colonne override + helper
- Entité `product.priceOverrideMinorUnits` (nullable) + migration **réversible** `1723-AddProductPriceOverride`.
- `products/price-resolve.ts` `resolveEffectivePrice(global, override)` (override prioritaire) + spec → **4/4 PASS**.

### BLOC 22 — POS-061 câblage prix effectif
- `createSale` : prix ligne = `resolveEffectivePrice(product.priceMinorUnits, product.priceOverrideMinorUnits)` (override prioritaire ; NULL → prix global, aucun changement). `TD-061-OVERRIDE` résolu.

### BLOC 23 — tests + docs
- `tsc --noEmit` → **EXIT 0** (entité + 2 migrations + createSale + products.service).
- Suites helpers session : **110 PASS** (106 + price-resolve 4) ; `products.service.spec` 7/7.
- MAJ `CLAUDE.md` (19 migrations + liste), `POS_BLOCKS.md`, `TECHNICAL_DEBT.md`, ce journal.

**Honnête** : migrations 1722/1723 **non exécutées** ici (pas de DB ; interdit prod) → `npm run migration:run` en local. Dédup nom rétroactive sur lignes héritées (accents) = `TD-066-LEGACY-BACKFILL`. UI back-office override = `TD-061-UI`. Suites lourdes (sale-transaction) à relancer local.

**Git** : ref bloquée (sandbox) ; backup régénéré.

**Prochain paquet** : PAQUET 20 ci-dessous.

---

## PAQUET 20 — Sécurité reçus + helpers transverses — BLOCS 24→30 (2026-06-28)

| Bloc | Sujet | Résultat | Preuve |
|---|---|---|---|
| BLOC 24 | POS-132 anti-XSS reçus | ✅ `common/html-escape.ts` extrait + appliqué | spec **5/5** (payloads `<script>`/`<img onerror>` neutralisés) |
| BLOC 25 | POS-085 inventaire/écart | ✅ `inventory-adjust.ts` branché (`applyScansToStock`) | spec **7/7** |
| BLOC 26 | Devises | ✅ `currency/convert-amount.ts` (`convertMinor`) branché | spec **4/4** |
| BLOC 27 | POS-055 quiet-hours/fériés | 🟡 helper testé, non branché (`TD-055-QUIET-HOURS-WIRING`) | spec **5/5** |
| BLOC 28 | Vérification | ✅ suite helpers complète | **18 suites / 133 PASS** |
| BLOC 29 | Docs | ✅ POS_BLOCKS/TECHNICAL_DEBT/exec-log MAJ | — |
| BLOC 30 | Backup git | ✅ commit objet + patch régénérés | ci-dessous |

**Découverte** : POS-132 déjà mitigé (`esc` appliqué partout) → **durci** en extrayant `escapeHtml` testé. Reçu public = design QR client (note).

**tsc --noEmit** → EXIT 0. Aucune migration (extractions behavior-preserving). 

**Honnête** : POS-055 non branché ; suites lourdes (sale-transaction/fiscal) non exécutables ici ; Paywin24/Comptamax24 non branchés.

**Git** : ref bloquée (FUSE) ; backup régénéré (`_BACKUP_PAQUET_2-20.patch`).

**Prochain paquet** : PAQUET 21 ci-dessous.

---

## PAQUET 21 — Z-report agrégation (POS-122) — BLOC 31 (2026-06-28)

**Réalisé & VÉRIFIÉ RUNTIME** :
- `reports/z-report-aggregate.ts` (`aggregateZReport` : revenu/TVA/remise, split cash/card, top produits triés, peak hours, panier moyen). Logique extraite verbatim de `generateZReport` (behavior-preserving).
- `generateZReport` branché sur l'agrégateur.
- `z-report-aggregate.spec` → **6/6** ; régression `reports.service.spec` → **OK** (8/8 ensemble).
- `tsc --noEmit` → **EXIT 0**.

**Couverture** : POS-122 ✅ (agrégation testée ; Z-report immuable après génération — pas d'UPDATE/DELETE sur le rapport).

**Fichiers** : +`reports/z-report-aggregate.ts`, +`z-report-aggregate.spec.ts` ; modifié `reports.service.ts` ; MAJ `POS_BLOCKS.md`, ce journal.

**Tests cumul session** : 19 suites helpers → **139 PASS** (133 + 6). `tsc` clean.

**Git** : ref bloquée (sandbox) ; backup régénéré.

**Prochain paquet** : PAQUET 22 ci-dessous.

---

## PAQUET 22 — Hygiène backups + ventes par employé — BLOCS 32-33 (2026-06-28)

### BLOC 32 — hygiène git
- `.gitignore` : ajout `_BACKUP_PAQUET_*.patch` (les patches de backup grossissaient récursivement car `git add -A` les ré-embarquait). Les prochains snapshots les excluent.

### BLOC 33 — POS-094 ventes par employé
- `reports/sales-by-employee.ts` (`aggregateSalesByEmployee` : count/CA/remise/panier moyen par employé, tri CA desc) + spec → **4/4 PASS**. Foundation reporting (endpoint = follow-up).
- Actions sensibles déjà auditées (audit hash-chain + `manual_discount_applied/blocked` + voidSale guard).
- `tsc --noEmit` → **EXIT 0**.

**Tests cumul session** : 20 suites helpers → **143 PASS** (139 + 4). `tsc` clean.

**Git** : ref bloquée (sandbox) ; backup régénéré (désormais sans les `_BACKUP_*.patch` → snapshot allégé).

**Prochain paquet** : PAQUET 23 ci-dessous.

---

## PAQUET 23 — POS-094 endpoint ventes/employé — BLOC 34 (2026-06-28)

**Réalisé & VÉRIFIÉ** :
- `reports.service.getSalesByEmployee(storeId, date)` (query ventes complétées du jour → `aggregateSalesByEmployee`).
- Endpoint `GET /api/reports/sales-by-employee` (`@Roles('admin','manager')`, admin cross-store via `?storeId`).
- Régression `reports.service.spec` + `sales-by-employee.spec` → **6/6 PASS**. `tsc --noEmit` → **EXIT 0**.

**Couverture** : POS-094 ✅ (endpoint + agrégateur testé). Runtime DB de la query → à valider local.

**Fichiers** : modifié `reports.service.ts` (méthode + import), `reports.controller.ts` (route) ; MAJ `POS_BLOCKS.md`, ce journal.

**Tests cumul session** : 20 suites → **143 PASS** (inchangé côté pur ; +endpoint câblé/tsc).

**Git** : ref bloquée (sandbox) ; backup régénéré (sans `_BACKUP_*.patch`).

**Prochain paquet** : PAQUET 24 ci-dessous.

---

## PAQUET 24 — Fix validation paiement avoir + DTO historique — BLOCS 35→39 (2026-06-28)

### BLOC 35-37 — POS-040/043 fix `store_credit` (BUG RÉEL)
- **Bug** : `SalePaymentDto.@IsIn` n'incluait pas `store_credit` + pas de `creditNoteCode` → avec `forbidNonWhitelisted`, un paiement avoir était **rejeté** (redemption cassée via l'endpoint).
- **Fix** : `common/payment-methods.ts` (`PAYMENT_METHODS` incl. `store_credit`) + `SalePaymentDto` (`@IsIn(PAYMENT_METHODS)` + `creditNoteCode`).
- Specs `payment-methods` 3/3 + `sales.dto` 4/4 → **7/7 PASS**.

### BLOC 38 — POS-018b DTO historique validé
- `sales/dto/list-sales-query.dto.ts` câblé dans `findAll` (types/bornes, limit≤100, UUID). Spec **4/4**.

### BLOC 39 — docs + backup
- `tsc --noEmit` → **EXIT 0**. MAJ docs. Backup régénéré.

**Tests cumul session** : 23 suites → **154 PASS** (143 + 7 + 4). `tsc` clean.

**Honnête** : fix store_credit prouvé au niveau validation DTO ; flux complet avoir-en-vente à re-tester via suite lourde (local). Git ref bloquée (FUSE).

**Prochain paquet** : PAQUET 25 ci-dessous.

---

## PAQUET 25 — POS-073 usage-limit + extractions vente — BLOCS 40→46 (2026-06-28)

### BLOCS 40-42 — POS-073 plafond d'usage promo
- Entité `promo_rule.usageLimit`/`usageCount` + migration **réversible** `1724-AddPromoUsageLimit` (additive).
- `isUsageLimitReached` (promo-policy) + tests ; `getActivePromos` exclut les promos au plafond (SQL `usage_limit IS NULL OR usage_count < usage_limit`).
- `promo-policy.spec` (11) + `promotions.service.spec` (14, dont clause usage) → **25/25 PASS**.
- **Différé** : incrément `usage_count` à l'application (write money-path) → `TD-073-USAGE-INCREMENT`.

### BLOCS 44-45 — extractions pures depuis createSale
- `sales/ticket-number.ts` (`formatTicketNumber`) **2/2** + branché.
- `sales/loyalty-points.ts` (`loyaltyPointsEarned` 1pt/€) **3/3** + branché.

### BLOC 43/46 — docs + backup
- `tsc --noEmit` → **EXIT 0**. CLAUDE migrations 19→20 + liste ; POS_BLOCKS/TECHNICAL_DEBT MAJ. Backup régénéré.

**Tests cumul session** : ~27 suites → **164 PASS** (154 + 3 usage + 2 ticket + 3 loyalty... helpers purs ; régressions services incl.). `tsc` clean.

**Honnête** : usage-limit = **exclusion** prouvée ; décompte (increment) non câblé. Migrations non exécutées ici (local). Git ref bloquée (FUSE).

**Prochain paquet** : PAQUET 26 ci-dessous.

---

## PAQUET 26 — POS-100 export comptable local — BLOCS 47→51 (2026-06-28)

### BLOCS 47-48 — builder + CSV (purs)
- `reports/accounting-export.ts` : `buildDailyAccountingExport` (TTC/HT/TVA, cash/card/autres, remise, nb tickets) + `toAccountingCsv` (";", montants en unités majeures). Spec **5/5**.

### BLOC 49 — service + endpoint
- `getAccountingExport(storeId, date, format)` depuis le **Z-report figé** (refus si absent) ; endpoint `GET /api/reports/accounting-export?format=csv|json` (admin/manager). Régression `reports.service.spec` → **7/7 ensemble**. `tsc` EXIT 0.

### BLOC 50-51 — docs + backup
- POS_BLOCKS POS-100 ; POS_INTEGRATIONS (Comptamax24 : export local 🟡 / envoi ⛔ `TD-COMPTAMAX`) ; ce journal. Backup régénéré.

**Honnête** : **export LOCAL** (données + CSV) uniquement. **Envoi Comptamax24 NON implémenté** (externe). Aucune conformité comptable/fiscale déclarée. Migrations non exécutées ici ; git ref bloquée (FUSE).

**Tests cumul session** : ~28 suites → **≥169 PASS**. `tsc` clean.

**Prochain paquet** : PAQUET 27 ci-dessous.

---

## PAQUET 27 — TimeWin24 : durcissement HMAC + mapping — BLOCS 52→56 (2026-06-28)

### BLOCS 52-53 — Auth HMAC pos-feed (sécurité)
- Extraction de la signature HMAC de `fetchWithPosSecret` → `timewin/pos-hmac.ts` (`signPosPayload`, `buildPosHmacHeaders` : `HMAC-SHA256(secret, ts.nonce.body)` + 4 headers). Service refactoré (comportement préservé).
- `pos-hmac.spec` **5/5** (signature = HMAC manuel, déterminisme, sensibilité body/nonce, headers). Régression `timewin.controller.spec` OK.

### BLOC 54 — Mapping employés TW24→cache
- `timewin/employee-map.ts` (`mapTimewinEmployee`) extrait de `syncEmployees` + branché ; `posPinHash` vide (PIN non renvoyé par TW24), skills défaut []. Spec **3/3**.

### BLOC 55-56 — docs + backup
- `tsc --noEmit` → **EXIT 0** (import `createHmac` retiré, pas d'inutilisé). POS_BLOCKS POS-092 + POS_INTEGRATIONS MAJ. Backup régénéré.

**Tests** : pos-hmac 5 + employee-map 3 + timewin.controller 18 → **26/26 PASS**. `tsc` clean.

**Honnête** : **connectivité TimeWin24 réelle non testée ici** (réseau/sandbox) — HMAC et mapping prouvés en unitaire ; le flux live (login/sync/shifts) reste à valider en local/staging. Circuit breaker OPEN signalé en avril → re-vérifier. TimeWin24 = source de vérité HR ; CAISSE n'en cache qu'une projection lecture seule.

**Tests cumul session** : ~30 suites → **≥177 PASS**. `tsc` clean.

**Prochain paquet** : PAQUET 28 ci-dessous.

---

## PAQUET 28 — POS-102 rapprochement paiements — BLOCS 57→61 (2026-06-28)

- `reports/payments-breakdown.ts` (`aggregatePaymentsByMethod` : count/total par méthode, tri desc) — spec **3/3**.
- `getPaymentsBreakdown(storeId, date)` + endpoint `GET /api/reports/payments-breakdown` (admin/manager). Régression `reports.service.spec` → **5/5 ensemble**. `tsc` EXIT 0.
- POS_BLOCKS POS-102 MAJ ; backup régénéré.

**Honnête** : Paywin24 (paie) = intégration externe **non implémentée** (pas de spec/secret → pas de stub inventé). Pièces justificatives = follow-up. Runtime DB endpoint à valider local. Git ref bloquée (FUSE).

**Tests cumul session** : ~31 suites → **≥180 PASS**. `tsc` clean.

**Prochain paquet** : PAQUET 29 ci-dessous.

---

## PAQUET 29 — Consolidation & vérification globale (2026-06-28)

**Vérification complète relancée (sandbox, 3 lots)** :
- Lot A (helpers purs) : 13 suites / **106 PASS**.
- Lot B (helpers + DTO) : 13 suites / **60 PASS**.
- Lot C (services à repo mocké, régressions) : 7 suites / **57 PASS**.
- **Total vérifié : 223 PASS / 33 suites.** `tsc --noEmit` EXIT 0.

**Docs** : `PROJECT_STATUS.md` §0 bilan session ajouté ; `MASTER_ROADMAP.md` jalons M3-M8 passés en 🔄 avec détail réel ; backup régénéré.

**Honnête (rappel)** : suites lourdes (sale-transaction/fiscal/pg-mem) non exécutées ici ; runtime DB endpoints + migrations 1721-1724 à valider en local ; Paywin24/Comptamax24 (envoi) non branchés ; git ref bloquée (FUSE) → `GIT_RECOVERY.md`.

**Prochain paquet** : PAQUET 30 ci-dessous.

---

## PAQUET 30 — Stripe Terminal idempotence — BLOCS 62→65 (2026-06-28)

- Extraction de la clé d'idempotence PaymentIntent → `stripe-terminal/payment-intent-key.ts` (`paymentIntentIdempotencyKey` = sha256(store:ticket:amount:currency:employee)). Service refactoré (comportement préservé).
- `payment-intent-key.spec` **5/5** (= sha256 documenté, déterminisme anti double-charge, sensibilité amount/ticket, segment employé vide). Régression `stripe-terminal.service.spec` → **9/9 ensemble**. `tsc` EXIT 0.
- POS_BLOCKS POS-033/041 MAJ ; backup régénéré.

**Honnête** : **paiement réel Stripe non testé** (interdit / pas de TPE) — seule la clé d'idempotence est prouvée en unitaire. Git ref bloquée (FUSE).

**Tests cumul session** : ~35 suites → **≥232 PASS**. `tsc` clean.

**Prochain paquet** : PAQUET 31-33 ci-dessous.

---

## PAQUET 31 — Jackpot decision (2026-06-28)
- `jackpot/jackpot-decision.ts` (`decideJackpotOutcome` : arbre mega/small/no_win, rolls injectés → déterministe) extrait de `rollLottery` (comportement préservé) + branché. Spec **8/8** (inactif, mega quota/densité/proba, small quota/proba, priorité mega, no_win). `tsc` EXIT 0.

## PAQUET 32 — Coupon cooldown (loyalty)
- `coupon-policy.daysRemainingInCooldown` (ceil jours restants) + tests ; `calculateNextReward` refactoré pour `isInCooldown`/`cooldownEnd`/`daysRemainingInCooldown` (comportement préservé). `coupon-policy` 8 + `coupon.service` régression 6 → **OK**. `tsc` EXIT 0.

## PAQUET 33 — Consolidation
- Total session vérifié (réexécution lots) ≈ **240+ PASS**. `tsc` clean. Backup régénéré.

**Honnête** : jackpot/coupon = logique de jeu/fidélité (pas fiscal). Suites lourdes + migrations + endpoints runtime → local. Paywin24/Comptamax24 (envoi) non branchés. Git ref bloquée (FUSE).

**Prochain paquet** : PAQUET 34 ci-dessous.

---

## PAQUET 34 — Sync offline : résolution de conflit (POS-049/086) (2026-06-28)

- `sync/conflict.ts` (`isServerNewerThanSync`, `resolveCustomerSync` server-wins quand le serveur a changé depuis `lastSyncAt`) extrait de `sync.push` (comportement préservé) + branché.
- `conflict.spec` **7/7** ; régression `sync.service.spec` → **9/9 ensemble**. `tsc --noEmit` EXIT 0.
- POS_BLOCKS POS-086 MAJ ; backup régénéré.

**Honnête** : résolution conflit **client** (loyaltyPoints, server-wins) testée ; ventes dédupliquées par idempotence. Cohérence **stock** offline/online reste liée au gate `TD-STOCK-TWO-SYSTEMS`. Suites lourdes + migrations + runtime → local. Git ref bloquée (FUSE).

**Tests cumul session** : ~38 suites → **≈250 PASS**. `tsc` clean.

**Prochain paquet** : PAQUET 35 ci-dessous.

---

## PAQUET 35 — Customer-visits : analytique de fréquence (2026-06-28)

- **Feature documentée mais absente** (le module ne faisait que record/list). Ajouté : `customer-visits/visit-frequency.ts` (`computeVisitFrequency` : count, premier/dernier, intervalle moyen, récence, segment new/regular/occasional/at_risk/unknown ; seuils par défaut tunables).
- `visit-frequency.spec` **6/6** (vide/unique/regular/at_risk/occasional/tri). Câblé : `customer-visits.service.getFrequency(customerId)`. `tsc` EXIT 0.

**Honnête** : segments = seuils par défaut (décision produit possible) ; endpoint REST = follow-up (méthode service prête). Suites lourdes/migrations/runtime → local. Git ref bloquée (FUSE).

**Tests cumul session** : ~39 suites → **≈256 PASS**. `tsc` clean.

**Prochain paquet** : PAQUET 36 — bascule validation locale recommandée, ou subscriptions/loyalty si demandé. Sur GO.

---

## CORRECTION D'ÉTAT (2026-06-28) — preuves + honnêteté

- **PAQUET 35 prouvé** : `visit-frequency.spec` → 6/6 PASS (exit 0) ; `tsc --noEmit` → exit 0 (sorties réelles).
- **BLOC 67 (endpoint fréquence)** : **NON LIVRÉ** → reclassé **différé** `TD-094-FREQ-ENDPOINT`. Seule la méthode service existe ; aucun controller `customer-visits` ; méthode non consommée (vérifié). À finir avec GET fail-closed + RBAC + anti-IDOR sur `customerId`.
- **Seuils segment** : provisoires, **non consommés** pour piloter un comportement (vérifié grep) → `TD-VISIT-SEGMENT-THRESHOLDS` (à ratifier).
- **ÉTAT GIT PROUVÉ** : HEAD = `c55e6c5` (PAQUET 1) ; paquets 2→35 **non commités** (working tree = vérité) ; « backup commits » = objets **pendants** non référencés (`branch --contains` vide, `is-ancestor HEAD` rc1). Cause : verrous FUSE non supprimables. → `GIT_RECOVERY.md` + `CONSOLIDATION_LOCALE.md`.
- **STOP** : aucun nouveau paquet, aucune migration, aucun build tant que l'état git n'est pas sécurisé en local. Migrations 1721-1724 = **non rejouées = non prouvées**.

---

## CONSOLIDATION RÉELLE (2026-06-28) — FUSE contourné
- Clone hors-FUSE `/tmp/caisse-rec` + overlay working tree → **commit réel** `7fd73bd` sur branche `recovery/pos-audit-session` (parent `c55e6c5`), working tree **clean**.
- **Build** `nest build` (clone) → **RC=0**, `dist/main.js` régénéré. Tests arbre commité (clone) : 42 PASS (échantillon) + 223 prouvés (mnt).
- **Bundle** `pos-recovery.bundle` (verify OK, complete history) → racine repo + outputs. Intégration : `git fetch ./pos-recovery.bundle recovery/pos-audit-session` puis merge.
- **Migrations** : non rejouées (pas de DB sandbox : 5432 refused, psql absent, DATABASE_URL vide ; `.env`=DB réelle → interdit). 

## PAQUET 36 — POS-094 endpoint fréquence (clôt TD-094-FREQ-ENDPOINT)
- `customer-visits.controller` `GET :customerId/frequency` (Jwt+Roles `manager` **fail-closed**) + anti-IDOR `customer-access.canAccessCustomer` (**4/4**) + `getFrequencySecured` (404 si client absent, 403 hors store, admin bypass). Module : +`CustomerEntity` + controller.
- `tsc --noEmit` → **EXIT 0**. Helper testé ; runtime DB endpoint à valider local.
- Consolidé dans le commit réel (re-bundle après ce paquet).

## PAQUET 37 — Occupancy level (cockpit/radar)
- `occupancy/occupancy-level.ts` (`occupancyLevel` empty/low/medium/high/full/unknown ; `isOccupancyStale`) + spec **5/5**. Service `getView(storeId, capacity)` câblé. `tsc` EXIT 0. Seuils ratio = défauts opérationnels (tunables). Commité réel + re-bundle.

## PAQUET 38 — Subscriptions policy
- `subscriptions/subscription-policy.ts` (`isUnlimited`, `isWithinLimit`, `subscriptionAccessDenial` suspended/expired) + spec **7/7**. Branché : `enforceProductLimit`/`enforceEmployeeLimit` (limites) + `assertActive` (denial) — comportement préservé. `tsc` EXIT 0. Commité réel + re-bundle.

## PAQUET 39 — EAN-13 check digit (produits)
- `products/ean13.ts` (`ean13CheckDigit` mod-10 GS1, `isValidEan13`, `buildEan13`, `isInternalEan`, `INTERNAL_EAN_PREFIX`) + spec **9/9**. Branché : `generateBarcode` (remplace le calcul inline, comportement préservé). `tsc` EXIT 0. Commit réel `8864aa6`.

## PAQUET 40 — PIN policy (employés)
- `employees/pin-policy.ts` (`isValidPinFormat` 4–8 chiffres ; `isWeakPin` **advisory, non branché**) + spec **6/6**. Branché : `validatePinFormat`. `tsc` EXIT 0. Commit réel `c0e490c`. TD : `isWeakPin` disponible mais non appliqué (changerait les PIN acceptés).

## PAQUET 41 — code avoir/gift (returns)
- `returns/credit-code.ts` (`normalizeCreditCode` trim+upper, `formatCreditCode` prefix+10 hex, `isGeneratedCreditCode`, `AVOIR_PREFIX`/`GIFT_PREFIX`) + spec **6/6**. Branché : `genCode`, `genGiftCode`, normalisation gift code + lookup redemption (comportement préservé). `tsc` EXIT 0. Commit réel `88a7f3f`.

## PAQUET 42 — loyalty QR token expiry
- `loyalty-card/qr-token.ts` (`tokenExpiresAt`, `isTokenExpired` strict `>`, `constantTimeEqual`, `hasRequiredClaims`, `isCardActive`, `QR_TTL_SECONDS`) + spec **8/8**. Branché : `LoyaltyTokenService.generate/verify` (TTL, expiry, compare const-time, claims) + `LoyaltyCardService` (garde `isCardActive` ×2). `tsc` EXIT 0. Commit réel `f8ff602`.

## PAQUET 43 — consolidation finale (39→42)
- Vérif globale : `tsc --noEmit` **EXIT 0** ; 4 nouvelles suites ensemble **29/29 PASS**.
- Chaîne de commits réels : `f8ff602` → `88a7f3f` → `c0e490c` → `8864aa6` → `b3d74d3` (PAQUET 38) … → `c55e6c5` (PAQUET 1). Branche `recovery/pos-audit-session`, working tree **clean**.
- **Bundle** `pos-recovery.bundle` rafraîchi (verify OK) → racine + outputs.
- **Non prouvé (honnête)** : suites lourdes ts-jest/pg-mem, migrations 1721-1724, `npm run build:backend` complet → à valider en local (pas de DB/temps en sandbox).

## PAQUET 44 — stock-locations quantités
- `stock-locations/dispatch-policy.ts` (`isPositiveQuantity`, `sumDispatchQuantities`, `hasSufficientStock`) + spec **6/6**. Branché : adjust/transfer (quantité>0) + dispatch (total>0, stock suffisant, skip ligne ≤0). `tsc` EXIT 0. Commit réel `03b5cfe`.

## PAQUET 45 — customers OTP policy
- `customers/otp-policy.ts` (`formatOtpCode`, `otpExpiresAt`, `isOtpExpired`, `isOtpMaxAttempts` cap 5, `otpCodeMatches`, `OTP_TTL_MS` 10min) + spec **5/5**. Branché : génération + `verifyOtp` (expiry/attempts/match) ; statics morts supprimés. `tsc` EXIT 0. Commit réel `11125d5`.

## PAQUET 46 — notifications policy
- `notifications/reminder-policy.ts` (`daysSince`, `isInactiveCustomer`, `baseReactivationPriority`, `priorityRank`, `stockNotificationLevel`) + spec **10/10**. Branché : rappels fidélité (jours/inactif/priorité base+tri, messages inchangés) + notifications stock (sévérité out/critical/alert). `tsc` EXIT 0. Commit réel `87f7eba`. TD : cutoffs 60/90j = défauts opérationnels (tunables).

## PAQUET 47 — sales-ai reco scoring
- `sales-ai/reco-scoring.ts` (`rate` division sûre ; `scoreRecommendation` neutre<min / blacklist<3% / penalize<5% / boost≥10% conv / score gradué) + spec **6/6**. Branché : `ai-learning.getProductPerformance` (score+statut) + perf magasin (ctr/convRate via `rate`, seuils importés). Logique du 2e bloc (sans boost/neutre) **préservée**. `tsc` EXIT 0. Commit réel `084557a`.

## PAQUET 48 — consolidation (44→47)
- Vérif globale : `tsc --noEmit` **EXIT 0** ; 4 nouvelles suites ensemble **27/27 PASS**.
- Chaîne réelle : `084557a` → `87f7eba` → `11125d5` → `03b5cfe` → `8cfbb13` (P43) … → `c55e6c5` (P1). Branche `recovery/pos-audit-session`, working tree **clean**.
- **Bundle** `pos-recovery.bundle` rafraîchi (verify OK) → racine + outputs.
- **Non prouvé (honnête)** : suites lourdes ts-jest/pg-mem, migrations 1721-1724, `npm run build:backend` complet → à valider en local (pas de DB/temps en sandbox).

## PAQUET 49 — sales-ai upsell scoring (V4)
- `sales-ai/upsell-scoring.ts` (co-occurrence/margin%/margin-score/stock-pressure score+label/temporal/consistency/`upsellConfidence` pondéré/`estimatedCashImpact`) + spec **12/12**. Branché : `getProductAssociations` (5 sous-scores + confiance + label stock + cash impact) ; consts W_*/OVERSTOCK déplacées dans le helper. `tsc` EXIT 0. Commit réel `9a2aff7`.

## PAQUET 50 — sales-ai weather impact
- `sales-ai/weather-impact.ts` (`weatherImpact(temp,condition)` → score -1..+1 + raison FR ; ordre pluie>neige/tempête>chaud>froid>beau) + spec **7/7**. Branché : `external-context` (calcul impact météo). `tsc` EXIT 0. Commit réel `46c88a9`.

## PAQUET 51 — stores network stats
- `stores/network-stats.ts` (`aggregateNetworkTotals` totaux+avg ticket sans /0 ; `isTimeWinActive`) + spec **3/3**. Branché : dashboard réseau (totaux) + sync TW24 (mapping statut ×2). `tsc` EXIT 0. Commit réel `1a53d23`.

## PAQUET 52 — fiscal chain linkage (NF525)
- `fiscal/chain-linkage.ts` (`checkChainLinkage` fork/no_genesis/multiple_genesis/orphan/unreachable ; `GENESIS` ; `ChainIssue`) + spec **5/5**. Extrait de `FiscalVerifyService.checkLinkage` (méthode privée → helper pur, re-export `ChainIssue`). `tsc` EXIT 0. Commit réel `139f6cc`.

## PAQUET 53 — consolidation (49→52)
- Vérif globale : `tsc --noEmit` **EXIT 0** ; 4 nouvelles suites ensemble **27/27 PASS**.
- Chaîne réelle : `139f6cc` → `1a53d23` → `46c88a9` → `9a2aff7` → `9ebb192` (P48) … → `c55e6c5` (P1). Branche `recovery/pos-audit-session`, working tree **clean**.
- **Bundle** `pos-recovery.bundle` rafraîchi (verify OK) → racine + outputs.
- **Non prouvé (honnête)** : suites lourdes ts-jest/pg-mem, migrations 1721-1724, `npm run build:backend` complet → à valider en local (pas de DB/temps en sandbox).

## PAQUET 54 — promotions discount math
- `promotions/promo-discount.ts` (`buyXGetDiscount`, `percentageDiscount`, `firstPurchaseDiscount` 5%, `lineTotal`) + spec **7/7**. Branché : `applyPromotions` (3 cas + first_purchase). `tsc` EXIT 0. Commit réel `6576ad9`.

## PAQUET 55 — sales discount totals
- `sales/discount-totals.ts` (`computeMaxAllowedDiscount` floor cap employé ; `discountPercentOfSubtotal` 2 déc., null si subtotal 0) + spec **3/3**. Branché : `createSale` (plafond remise + payload audit). `tsc` EXIT 0. Commit réel `4fef264`.

## PAQUET 56 — products period analytics
- `products/product-analytics.ts` (`periodDays`, `unitsPerDayRate`, `perDayMinor`, `marginPercentOf`, `deltaPct`) + spec **7/7**. Branché : analytics par période de prix (durée/jour/marge/delta). `tsc` EXIT 0. Commit réel `f58ece2`.

## PAQUET 57 — stock adjustment clamp
- `stock/stock-level.ts` +`applyStockAdjustment` (delta/absolu, clamp ≥0) + spec **4/4**. Branché : `adjustStock` (remplace `Math.max(0, …)` ×2). `tsc` EXIT 0. Commit réel `b74597b`.

## PAQUET 58 — consolidation (54→57)
- Vérif globale : `tsc --noEmit` **EXIT 0** ; 4 nouvelles suites ensemble **21/21 PASS**.
- Chaîne réelle : `b74597b` → `f58ece2` → `4fef264` → `6576ad9` → `10a25d2` (P53) … → `c55e6c5` (P1). Branche `recovery/pos-audit-session`, working tree **clean**.
- **Note infra** : sandbox redémarrée — clone `/tmp` + identité git + `/tmp/jest.fast.cjs` reconstruits depuis le bundle (tip P53 vérifié `10a25d2` avant reprise) ; bundle rafraîchi à chaque paquet par sécurité.
- **Non prouvé (honnête)** : suites lourdes ts-jest/pg-mem, migrations 1721-1724, `npm run build:backend` complet → à valider en local.

## PAQUET 59 — sales-ai temporal pattern
- `sales-ai/temporal-pattern.ts` (`avgTicketsPerDay`, `avgRevenuePerDay`, `avgBasket`, `rushThreshold`, `isRush`, `RUSH_THRESHOLD_MULTIPLIER`) + spec **7/7**. Branché : patterns horaires (moy/jour, panier, rush) ; const RUSH déplacée. `tsc` EXIT 0. Commit réel `df69efb`.

## PAQUET 60 — returns refund policy
- `returns/refund-policy.ts` (`isValidRefundMethod`, `creditNoteRefundState` type/method/status/remaining, `isSpendableStoreCredit`) + spec **6/6**. Branché : `createReturn` (validation + état avoir) + `lookupSpendable`. `tsc` EXIT 0. Commit réel `d1cbf6a`.

## PAQUET 61 — auth upstream status
- `auth/upstream-status.ts` (`isUpstreamUnavailable` : no-status/5xx vs 4xx) + spec **3/3**. Branché : `loginByQrCode` (branche fallback TW24 indisponible). `tsc` EXIT 0. Commit réel `a2c3432`.

## PAQUET 62 — timewin health status
- `timewin/health-status.ts` (`isHealthyTimeWinStatus` : ok/degraded) + spec **2/2**. Branché : `TimewinService.isHealthy`. `tsc` EXIT 0. Commit réel `35da5f1`.

## PAQUET 63 — consolidation (59→62)
- Vérif globale : `tsc --noEmit` **EXIT 0** ; 4 nouvelles suites ensemble **18/18 PASS**.
- Chaîne réelle : `35da5f1` → `a2c3432` → `d1cbf6a` → `df69efb` → `39424da` (P58) … → `c55e6c5` (P1). Branche `recovery/pos-audit-session`, working tree **clean**.
- **Bundle** rafraîchi à chaque paquet (volatilité /tmp) ; verify OK.
- **Non prouvé (honnête)** : suites lourdes ts-jest/pg-mem, migrations 1721-1724, `npm run build:backend` complet → à valider en local.

## PAQUET 64 — reports averageBasket (dédup)
- `reports/average-basket.ts` (`averageBasket(totalRevenue, txCount)` round, 0 si 0 tx) + spec **2/2**. **Dédup** : même formule présente dans `reports.service` (résumé jour) ET `z-report-aggregate` → consolidée (même module, sans couplage inter-modules). Comportement préservé. `tsc` EXIT 0. Commit réel à suivre.

## PAQUET 65 — sales stock decrement (réutilisation)
- `sales.service` décrément stock vente → réutilise `applyStockAdjustment(qty, -item.quantity, 'delta')` (clamp ≥0). Comportement préservé. `tsc` EXIT 0. Commit réel `70ecb89`.

## PAQUET 66 — pagination clamp (dédup)
- `common/pagination.ts` (`normalizePage`, `normalizeLimit`) + spec **4/4**. Dédup : products + returns. `tsc` EXIT 0. Commit réel `6908959`.

## PAQUET 67 — pagination totalPages (dédup)
- `common/pagination.ts` +`totalPages` (garde div/0) + spec **6/6**. Dédup `Math.ceil(total/limit)` ×4 : products/returns/customers/sales (0 résiduel vérifié). `tsc` EXIT 0. Commit réel `c8235a2`.

## PAQUET 68 — VÉRIFICATION d'agrégat (couche helpers)
- Lancement groupé de **toute** la couche de helpers purs : **64 suites · 405 tests · 405 PASS** (5,2 s) — aucune régression après 67 paquets. `tsc --noEmit` global **EXIT 0**.
- Constat honnête : l'extraction « comportement préservé » à forte valeur est désormais **quasi épuisée** (tous les helpers sont isolés + testés ; l'inline restant est soit côté SQL, soit non-déterministe). Les prochains paquets seront surtout vérification / dédup mineure / dette documentée, sans inventer de changement de comportement.

## PAQUET 69 — consolidation (65→68)
- Chaîne réelle : `c8235a2` → `6908959` → `70ecb89` → `1931962` (P64) … → `c55e6c5` (P1). Branche `recovery/pos-audit-session`, working tree **clean**.
- **Bundle** rafraîchi (complete history) à chaque paquet.
- **Non prouvé en sandbox** : suites lourdes ts-jest/pg-mem (Nest/pg-mem), migrations 1721-1724, `npm run build:backend` complet → à valider en local.

## PAQUET 70 — preuve build + durcissement POS-054
- **Build réel** (clone non-FUSE, node_modules liés) : `npx nest build` → **RC=0** ; `dist/main.js` émis ; **310** fichiers `.js` ; helpers de session compilés vérifiés (discount-policy, pagination, chain-linkage, average-basket). Première preuve d'émission complète rafraîchie cette session.
- **Durcissement POS-054** (vérification, sans changement de comportement) : `sales/discount-policy.edge.spec.ts` — **13/13 PASS**. Frontières confirmées : 20,99 % (pas de justif) / 21 % (justif requise) / 30 % (autorisé avec code+justif) / 30,01 % (POS_OVER_CAP) ; justif générique « client » rejetée ; code responsable obligatoire ; back-office >30 % exige motif+validateur ; répartition NF525 exacte (somme = remise, 0 ≤ ligne ≤ net). **Aucun bug détecté.**
- `tsc --noEmit` **EXIT 0**. Commit réel à suivre + bundle.

**Prochain paquet** : PAQUET 71 — vérification ciblée (helper fiscal/argent) ou dette documentée sur GO produit. Sur GO.

---

# ÉPIC INTÉGRATION POS ↔ Comptamax24 ↔ TimeWin24 (+ Analytik R ready) — GO 2026-06-29

> Voir `INTER_SYSTEM_INTEGRATION.md` (audit A, plan B, archi C/E, état F).

## PAQUET 71 — Outbox fondation
- `common/integration/integration-event.ts` (enveloppe normalisée + `buildIntegrationEvent` + `toOutboxRow`) + `IntegrationEventEntity` append-only + migration **1725 additive/réversible**. **6/6**, tsc 0. Commit `ce2012c`.

## PAQUET 72 — Events vente (transactional outbox)
- `sales/sale-events.ts` (1 `sale.completed` + N `payment.captured`) branché **dans la tx** de `createSale` ; entité dans SalesModule. **11/11**, **nest build RC=0**. Commit `7a5048a`.

## PAQUET 73 — Retours/avoirs + clôture caisse
- `returns/refund-events.ts` (`refund.created`/`credit_note.issued`) dans les tx returns + gift ; `reports/cash-session-events.ts` (`cash_session.closed`) **atomique avec le Z**. **4/4**, tsc 0. Commit `3a54266`.

## PAQUET 74 — Pré-compta Comptamax
- `comptamax/pre-accounting.ts` (moteur double-entrée équilibré, PCG) + `ComptamaxService`/`Controller` : `GET /api/comptamax/journal?date&format` lit l'outbox → journal jour/magasin (CSV/JSON), tenant + anti-IDOR. **9/9**, **nest build RC=0**. Commit `43c6a23`.

## PAQUET 75 — Rapprochement POS↔TimeWin
- `timewin/presence-reconciliation.ts` (moteur pur : minutes POS vs pointage, anomalies, tolérance) + `pos-session/session-events.ts` (`employee_activity.recorded` open/close, **best-effort non bloquant**). **12/12**, **nest build RC=0**. Commit `a05994d`.

## PAQUET 76 — TimeWin→Comptamax variables RH
- `comptamax/social-preaccounting.ts` (consolidation heures/absences/retards + CSV justificatif). Écritures sociales réelles **gated** (`TD-INT-SOCIAL-ENTRIES`). **5/5**, tsc 0. Commit `59802a7`.

## PAQUET 77 — Consolidation intégration
- Agrégat **8 suites / 41 tests** intégration PASS ; `tsc --noEmit` **EXIT 0** ; `INTER_SYSTEM_INTEGRATION.md` état F + dette/gates. Commit réel + bundle.
- **Non prouvé sandbox** : migration 1725, relais réel Comptamax/TimeWin (secrets/endpoints distants), suites lourdes → local.

**Prochain (sur GO)** : PAQUET 78 — relais outbox (poller pending→published) en simulation locale OU thread `organizationId`/`terminalId` OU endpoint export RH `GET /comptamax/social`.

## PAQUET 78 — Relais outbox (simulation)
- `common/integration/outbox-relay.ts` (policy pure : `isEligibleForRelay`/`relayBackoffMs`/`relayOutcome`) + `OutboxRelayService` + publisher **simulation** + `POST /integration/relay` (admin). **6/6**, build RC=0. Commit `cb4cbfb`.

## PAQUET 79 — Events stock/rupture (Analytik R)
- `stock/stock-events.ts` (`stock.movement`/`stock.depleted`) branché decrement (best-effort) + adjust (post-commit best-effort). **3/3**, build RC=0. Commit `9b25c65`.

## PAQUET 80 — Feed consommateur Analytik R
- `integration/events-query.ts` (normaliseur pur) + `OutboxQueryService` + `GET /integration/events` (curseur `occurredAt`, type, tenant). **4/4**, build RC=0. Commit `92d7447`.

## PAQUET 81 — Rapprochement présence branché
- `timewin/shift-adapter.ts` (pur, tolérant TW24) + `ReconciliationService` (POS DB + TW24 best-effort, dégradé gracieux) + `GET /integration/reconciliation`. **5/5**, build RC=0. Commit `1121faa`.

## PAQUET 82 — Consolidation intégration v2
- Agrégat **12 suites / 59 tests** intégration PASS ; `tsc --noEmit` **EXIT 0** ; `INTER_SYSTEM_INTEGRATION.md` addendum v2 + endpoints + gates. Commit réel + bundle.
- **Non prouvé sandbox** : migration 1725, publisher réel (secrets), suites lourdes → local.

**Prochain (sur GO)** : PAQUET 83 — publisher HTTP réel (gate secrets) OU thread org/terminal (TD-INT-ORG/TERMINAL) OU rapprochement par employé (TD-INT-RECON-PEREMP) OU scheduled task relais.

## PAQUET 83 — terminalId sur events vente
- `X-Terminal-Id` header → `createSale` → `sale.completed`/`payment.captured` `tenant.terminalId`. Chemin vente inchangé. tsc 0, build RC=0. Commit `2b2cd59`. **TD-INT-TERMINAL clos.**

## PAQUET 84 — Export RH /comptamax/social
- `comptamax/payroll-adapter.ts` (pur tolérant TW24) + `buildSocialExport` (best-effort/dégradé) + `GET /comptamax/social?period&format`. **4/4**, build RC=0. Commit `32b203c`.

## PAQUET 85 — Cron relais automatique
- `OutboxRelayCron` `@Cron(EVERY_5_MINUTES)` + toggle `OUTBOX_RELAY_ENABLED` (OFF défaut) + helper pur `isRelayCronEnabled`. **8/8**, build RC=0. Commit `983ac76`.

## PAQUET 86 — organizationId résolu
- `StoreOrgResolver` (cache store→org) câblé `createSale` → `tenant.organizationId`. tsc 0, build RC=0 (pas de cycle DI). Commit `73adb77`. **TD-INT-ORG clos (ventes).**

## PAQUET 87 — Test relais (mock)
- `OutboxRelayService` unit test (repo+publisher mockés) : éligibilité/skip-cap, succès→published, échec→failed/pending, throw non propagé. **2/2**. Commit `029df80`.

## PAQUET 88 — Consolidation intégration v3
- Agrégat **14 suites / 67 tests** intégration PASS ; `tsc --noEmit` **EXIT 0**. Commit réel + bundle.
- **Endpoints** : `/comptamax/journal`, `/comptamax/social`, `/integration/relay`, `/integration/events`, `/integration/reconciliation`. **Cron** relais (OFF défaut).
- **Gates restants** : `TD-INT-RELAY` publisher HTTP réel (secrets) · `TD-INT-SOCIAL-ENTRIES` · `TD-INT-RECON-PEREMP` · org sur retours/sessions/stock (ventes faites) · migration 1725 + suites lourdes = local.

**Prochain (sur GO)** : PAQUET 89 — publisher HTTP réel (gate secrets) OU org/terminal sur retours+sessions+stock OU rapprochement par employé.

## PAQUET 95 — Vérif HMAC livraison (anti-rejeu)
- `verifyPublishSignature` (timingSafe + fenêtre fraîcheur) — contrat signé symétrique. 8/8, tsc 0. Commit (réécrit).

## PAQUET 96 — TVA par taux (ventes)
- `taxBreakdownByRate` + `sale.completed.taxBreakdown` + Comptamax 1 ligne 44571/taux (équilibré). 25/25, build RC=0.

## PAQUET 97 — TVA par taux (avoirs)
- refund taxBreakdown + `buildRefundJournalLines` débit 44571/taux. **TD-INT-REFUND-TAX clos.** 15/15, build RC=0.

## PAQUET 98 — sale.voided + contre-passation
- event `sale.voided` (tx) + `reverseJournal` + Comptamax contre-passe (net zéro). 18/18, build RC=0.

## PAQUET 99 — Journal sur plage de dates
- `journal-range` (day/inclusive UTC) + `buildJournalRange` + `GET /comptamax/journal?from&to`. 5/5, build RC=0.

## PAQUET 100 — JALON consolidation finale
- **18 suites / 100 tests** intégration PASS ensemble ; `tsc` EXIT 0 ; `nest build` RC=0 (339 .js).
- `INTER_SYSTEM_INTEGRATION.md` §G : matrice events + endpoints + garanties + checklist activation prod.
- Cycle comptable complet & équilibré : vente, paiement, **annulation**, retour/avoir, carte cadeau, clôture Z — TVA par taux, jour ou période. Feed Analytik R + monitoring + rapprochement TimeWin + relais signé (simulation/HTTP gated) + cron.
- **Gates** (activation prod) : migration 1725 (`migration:run`) · publisher HTTP (`OUTBOX_PUBLISH_URL/SECRET`) · `OUTBOX_RELAY_ENABLED=true` · `TD-INT-SOCIAL-ENTRIES` (écritures sociales = décision compta). Suites lourdes = local.

**Cumul épic intégration : 30 paquets (71→100).**

## PAQUET 89 — organizationId sur tous events
- `StoreOrgResolver` câblé returns/reports(Z)/pos-session/stock. tsc 0, build RC=0, **TD-INT-ORG clos**. Commit (réécrit, voir tip).

## PAQUET 90 — HTTP publisher gated
- `publish-request.ts` (body+HMAC pur, 4/4) + `HttpOutboxPublisher` + factory `createOutboxPublisher` (réel si `OUTBOX_PUBLISH_URL`+`SECRET`, sinon simulation). build RC=0. **TD-INT-RELAY structuré (gate secret intact).**

## PAQUET 91 — Outbox stats
- `shapeOutboxStats` pur (3/3) + `GET /integration/outbox/stats` (backlog monitoring). build RC=0.

## HYGIÈNE CRITIQUE (entre P91 et P92)
- **Défaut corrigé** : `pos-recovery.bundle` se committait lui-même depuis P39 → historique gonflé à ~400 Mo. Détrack + `.gitignore *.bundle` + `git filter-branch` (purge du blob sur 57 commits) + gc → **.git 3,6 Mo, bundle 2,5 Mo**. rsync exclut désormais le bundle. **Hashes de commits réécrits** (nouveau tip ci-dessous). Aucune perte de code.

## PAQUET 92 — terminalId sur events retours
- `X-Terminal-Id` → createReturn/byTicket/issueGiftCard → refund/gift events `tenant.terminalId`. 3/3, build RC=0.

## PAQUET 93 — Rapprochement par employé
- `shift-adapter` filtre employé (8/8) + `reconcileToday(storeId, employeeId?)` + `GET /integration/reconciliation?employeeId`. build RC=0. **TD-INT-RECON-PEREMP traité** (TW24 store-feed sans id employé → shifts droppés, documenté).

## PAQUET 94 — Consolidation intégration v4
- Agrégat **16 suites / 77 tests** intégration PASS ; `tsc --noEmit` **EXIT 0**.
- Enveloppe outbox pleinement tenant : storeId + organizationId + terminalId (ventes+retours) sur tous les agrégats.
- **Endpoints** : `/comptamax/journal`, `/comptamax/social`, `/integration/relay`, `/integration/events`, `/integration/outbox/stats`, `/integration/reconciliation`. **Cron** relais (OFF défaut). **Publisher** factory (simulation/HTTP gated).
- **Gates restants** : `TD-INT-RELAY` (URL+secret prod) · `TD-INT-SOCIAL-ENTRIES` · migration 1725 + suites lourdes = local.

## PAQUET 101 — Plan de comptes Comptamax configurable (POS-INT-101)
- Objectif : rendre le plan comptable (PCG) surchargeable par déploiement, sans modifier le chemin caisse ni casser le défaut.
- Fichiers : `pre-accounting.ts` (type `AccountMap`, `resolveAccountMap(overrides?)` pur + builders `paymentAccount`/`buildSaleJournalLines`/`buildRefundJournalLines` acceptant un `accounts: AccountMap = ACCOUNTS`), `comptamax.service.ts` (résolution unique via env `COMPTAMAX_ACCOUNTS` JSON, parse tolérant), `account-map.spec.ts` (nouveau).
- Sécurité : surcharge clé-par-clé, valeurs non-string/vides/clés inconnues ignorées → jamais de compte invalide ; JSON invalide ⇒ warn + plan par défaut. Rétro-compatible (signatures avec défaut).
- Preuve tests : `account-map.spec.ts` + `pre-accounting.spec.ts` ⇒ 2 suites / 18 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0 (7 .js comptamax).
- Dette : inchangée (TD-INT-SOCIAL-ENTRIES, publisher HTTP réel = secrets, migration 1725 non jouée hors DB).
- Prochain paquet : P102 (axe utile à décider — ex. dédup consommateur par event id, ou mapping compte par méthode de paiement étendu).

## PAQUET 102 — Contrat d'idempotence consommateur (POS-INT-102)
- Objectif : préparer Comptamax24 / Analytik R à un traitement EXACTLY-ONCE des events outbox (livraison at-least-once : retry relais, rejeu, re-lecture du feed).
- Fichiers : `common/integration/consumer-dedup.ts` (pur, sans DB/Nest), `consumer-dedup.spec.ts` (nouveau).
- API : `isFreshEventId(id, seen)`, `dedupeBatch(events, seen?)` → {fresh, duplicates, seen}, `freshOnly(...)`, `seenSetFrom(ids)`. Le consommateur possède le store « seen » (Set/table/KV) ; le POS n'en dépend jamais (jamais bloqueur de caisse).
- Sémantique : ordre préservé, repeats intra-lot collapsés, event sans id traité comme doublon (drop sûr), rejeu du même lot ⇒ 0 fresh.
- Preuve tests : `consumer-dedup.spec.ts` ⇒ 1 suite / 10 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette : inchangée. Prochain : P103 (axe utile à décider).

## PAQUET 103 — Curseur consommateur composite (occurredAt, id) (POS-INT-103)
- Objectif : éliminer la perte d'events au même `occurredAt` à la frontière de page dans le feed `/integration/events` (Analytik R) — keyset pagination sans saut, complémentaire de la dédup P102.
- Problème réel : curseur timestamp-only (`MoreThan occurredAt`) saute les events partageant le timestamp de frontière quand une page coupe un groupe même-milliseconde.
- Fichiers : `events-query.ts` (`parseEventsCursor`, `encodeEventsCursor`, `NormalizedEventsQuery.sinceId`), `outbox-query.service.ts` (prédicat keyset `occurred_at > since OR (occurred_at = since AND id > sinceId)`, `orderBy occurred_at,id`, nextCursor = `"<iso>|<id>"`), specs mises à jour.
- Rétro-compatibilité : un `since` ISO nu (sans `|`) ⇒ comportement legacy strict-after-timestamp.
- Preuve tests : `events-query.spec.ts` ⇒ 1 suite / 9 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette : inchangée. Prochain : P104 (axe utile à décider).

## PAQUET 104 — Preuve runtime keyset sans DB (référence pure) (POS-INT-104)
- Objectif : prouver de façon déterministe (sans DB, hors gate pg-mem) que la pagination keyset P103 ne saute ni ne duplique aucun event, même avec gros groupes même-timestamp à cheval sur les pages.
- Fichiers : `events-keyset.ts` (pur : `compareKeyset`, `isAfterCursor`, `selectPage`, `drainAll` — miroir exact de la requête SQL de listForConsumer), `events-keyset.spec.ts` (nouveau).
- Preuve forte : `drainAll` à limit ∈ {1,2,3,4,7,100} ⇒ couverture totale exacte, 0 doublon ; cas démontrant la perte legacy (timestamp-only) vs résolution composite (e2..e5 conservés).
- Honnêteté : `events-keyset.ts` est une référence pure miroir ; le chemin exécuté reste le SQL de `OutboxQueryService` (validé tsc+build ; test DB runtime = gate pg-mem hors sandbox). Garde anti-régression du contrat.
- Preuve tests : `events-keyset.spec.ts` + `events-query.spec.ts` ⇒ 2 suites / 23 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette : inchangée. Prochain : P105 (axe utile à décider).

## PAQUET 105 — Event cash_session.opened (début de poste) (POS-INT-105)
- Objectif : combler l'asymétrie — `cash_session.opened` était déclaré dans l'union mais jamais émis (seul `.closed` via Z-report l'était). Émettre le signal de début de poste (terminal, employé, openedAt) pour Comptamax24/TimeWin24/Analytik R.
- Fichiers : `pos-session/session-events.ts` (`buildCashSessionOpenedEvent` pur + `CashSessionOpenedInput`), `pos-session.service.ts` (émission best-effort dans `recordSessionActivity('opened')` — insert groupé employee_activity + cash_session.opened), spec étendue.
- Non-bloquant : émission dans le catch best-effort existant ; une ouverture de session ne peut jamais échouer à cause de l'outbox. Distinct de `employee_activity.recorded` (temps travaillé).
- Preuve tests : `session-events.spec.ts` ⇒ 1 suite / 6 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette : inchangée. Prochain : P106 (axe utile à décider).

## PAQUET 106 — Agrégateur amplitude de poste (POS-INT-106)
- Objectif : exploiter le couple lifecycle P105 (`cash_session.opened`) + clôture (`employee_activity.recorded` action=closed) pour produire des shifts par session + totaux par employé — utile TimeWin24 (présence) et Analytik R (occupation).
- Fichiers : `timewin/shift-amplitude.ts` (pur : `summarizeShifts`, `toShiftEvents`, types `ShiftEvent`/`ShiftRecord`/`ShiftSummary`), `shift-amplitude.spec.ts` (nouveau).
- Robustesse : tolérant aux events hors-ordre (close avant open connu), open non apparié = poste en cours (open:true, durée 0), durée = durationMinutes explicite sinon (closedAt−openedAt), totaux par employé classés.
- Preuve tests : `shift-amplitude.spec.ts` ⇒ 1 suite / 7 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette : inchangée. Prochain : P107 (axe utile à décider).

## PAQUET 107 — Endpoint /integration/shifts (amplitude poste) (POS-INT-107)
- Objectif : exposer en lecture seule l'amplitude de poste P106 — `GET /integration/shifts?date=YYYY-MM-DD` (shifts open→close par session + totaux minutes par employé). Tenant-scoped (storeId du JWT, anti-IDOR), rôles admin/manager.
- Fichiers : `outbox-query.service.ts` (`shiftsForDay(storeId,date)` : lit cash_session.opened + employee_activity.recorded sur la journée via dayRangeUtc, applique toShiftEvents+summarizeShifts), `integration.controller.ts` (route `GET /integration/shifts`). Réutilise `dayRangeUtc` (comptamax) + `shift-amplitude` (timewin) — pas de duplication.
- Honnêteté : logique d'agrégation testée en P106 (pur) ; la méthode service est du glue (lecture DB + appel pur) validée par tsc+build, comme les endpoints events/reconciliation existants (test DB runtime = gate hors sandbox).
- Preuve tests (non-régression) : suites integration + timewin/shift-amplitude ⇒ 6 suites / 43 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette : inchangée. Prochain : P108 (axe utile à décider).

## PAQUET 108 — Consolidation v5 (jalon paquets 101→107) (POS-INT-108)
- Agrégat couche intégration : 22 suites / 144 tests PASS ensemble (common/integration, modules/integration, comptamax, timewin shift+presence+adapter, pos-session, sales events+tax, returns, reports, stock).
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Doc : section §H ajoutée à INTER_SYSTEM_INTEGRATION.md (récap P101–107, ajout matrice `cash_session.opened`, contrat consommateur exactly-once+sans-perte = curseur composite + dédup par id).
- Dette inchangée : TD-INT-SOCIAL-ENTRIES, publisher HTTP réel = secrets, migration 1725 + DB runtime = gate local.
- Cumul épic intégration : 38 paquets (71→108).

## PAQUET 109 — Export CSV amplitude de poste (POS-INT-109)
- Objectif : handoff paie/TimeWin — `GET /integration/shifts?date=&format=csv` renvoie le CSV des shifts (header stable, 1 ligne/shift).
- Fichiers : `timewin/shift-amplitude.ts` (`shiftsToCsv` pur, échappement CSV), `outbox-query.service.ts` (`shiftsForDayCsv`), `integration.controller.ts` (`format=csv|json`), spec étendue.
- Preuve tests : `shift-amplitude.spec.ts` ⇒ 1 suite / 9 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette : inchangée.

## PAQUET 110 — Contrôle écart de caisse (POS-INT-110)
- Objectif : rapprocher les totaux figés du Z-report (`cash_session.closed`) avec la somme des `payment.captured` du jour, par bucket de tender (cash/card/other) → détection d'écart de caisse, read-only (n'altère ni Z ni ventes).
- Fichiers : `comptamax/cash-control.ts` (pur : `reconcileCashControl`, `tenderBucket`, types), `cash-control.spec.ts` (nouveau).
- Robustesse : buckets cash/card/other, `other` sans contrepartie Z (declared=0) remonte en écart ; diff = capturé − déclaré ; balanced = tous diffs 0 ; montants centimes entiers.
- Preuve tests : `cash-control.spec.ts` ⇒ 1 suite / 5 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette : inchangée.

## PAQUET 111 — Endpoint /comptamax/cash-control (POS-INT-111)
- Objectif : exposer le contrôle d'écart de caisse P110 — `GET /comptamax/cash-control?date=YYYY-MM-DD` (capturé vs Z déclaré par bucket). Tenant-scoped (storeId JWT, anti-IDOR), rôles admin/manager.
- Fichiers : `comptamax.service.ts` (`buildCashControl` : lit payment.captured + cash_session.closed du jour, agrège cash/card déclarés, applique reconcileCashControl, renvoie zReportCount), `comptamax.controller.ts` (route).
- Honnêteté : logique pure testée P110 ; méthode service = glue lecture-DB validée tsc+build (test DB runtime = gate local).
- Preuve tests (non-régression) : agrégat 16 suites / 112 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette inchangée. Cumul épic : 41 paquets (71→111).

## PAQUET 112 — Export CSV contrôle de caisse (POS-INT-112)
- Objectif : justificatif comptable — `GET /comptamax/cash-control?date=&format=csv` (1 ligne/bucket + ligne TOTAL).
- Fichiers : `comptamax/cash-control.ts` (`cashControlToCsv` pur), `comptamax.service.ts` (`buildCashControlCsv`), `comptamax.controller.ts` (`format=csv|json`), spec étendue.
- Preuve tests : `cash-control.spec.ts` ⇒ 1 suite / 6 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette inchangée. Cumul épic : 42 paquets (71→112).

## PAQUET 113 — Durcissement anti-injection de formule CSV (POS-INT-113)
- Contexte : vérif utilisateur — il n'existait AUCUN échappeur durci partagé ; mon `csvCell` local (P109/P112) ne faisait que le quoting RFC4180, PAS la garde anti-formule. cash-control = enums+nombres (non exploitable), MAIS shifts (ids), journal (label) et social (employeeName) émettent du texte libre = vrai vecteur.
- Fichiers : `common/csv/csv-safe.ts` (NOUVEAU, pur : `csvSafeCell`/`csvSafeRow` — neutralise `= + - @` et tab/CR/LF en tête sur les cellules TEXTE par préfixe apostrophe, quoting RFC4180 ; nombres/booléens jamais gardés → `-100` reste un nombre), branché dans `cash-control.ts` (cashControlToCsv), `timewin/shift-amplitude.ts` (shiftsToCsv), `pre-accounting.ts` (journalToCsv : account+label), `social-preaccounting.ts` (workforceToCsv : employeeId+employeeName). Suppression des `csvCell` locaux.
- Décision de design : la garde s'applique aux STRINGS ; les montants centimes (nombres) passent verbatim → aucune corruption des négatifs comptables.
- Preuve tests : csv-safe (14) + cash-control (6) + pre-accounting (14, dont label `=cmd` neutralisé) + social (6, dont employeeName `=HYPERLINK` neutralisé) + shift-amplitude (9) ⇒ 5 suites / 47 tests PASS. Sorties verbeuses collées dans la conversation.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Honnêteté : correction d'un surstatement antérieur (« échappement CSV » ne couvrait pas l'injection de formule) ; désormais couvert et prouvé sur les 4 exports.
- Dette inchangée : TD-INT-SOCIAL-ENTRIES, publisher HTTP réel = secrets, migration 1725 + DB runtime = gate local. Cumul épic : 43 paquets (71→113).

## PAQUET 114 — Garde CSV sur export comptable POS-100 (POS-INT-114)
- Objectif : finir la couverture anti-injection — `toAccountingCsv` (reports/accounting-export.ts) émettait `date` + `storeId` (texte) sans garde.
- Fichiers : `reports/accounting-export.ts` (date+storeId via `csvSafeCell` ; montants major-units digit-leading raw), `accounting-export.spec.ts` (test injection storeId `=cmd` neutralisé).
- Couverture finale : 5/5 producteurs CSV gardés (journalToCsv, workforceToCsv, cashControlToCsv, shiftsToCsv, toAccountingCsv) — audit grep confirmé ; les contrôleurs ne font que router.
- Preuve tests : `accounting-export.spec.ts` ⇒ 1 suite / 6 tests PASS (verbeux collé).
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette inchangée. Cumul épic : 44 paquets (71→114).

## PAQUET 115 — Consolidation v6 (sécurité exports) (POS-INT-115)
- Agrégat couche intégration : 25 suites / 173 tests PASS ensemble (ajout common/csv + reports/accounting-export aux suites du jalon v5).
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Doc : section §I ajoutée à INTER_SYSTEM_INTEGRATION.md (récap P109–114, table des 5 exports CSV gardés + champs texte).
- Dette inchangée : TD-INT-SOCIAL-ENTRIES, publisher HTTP réel = secrets, migration 1725 + DB runtime = gate local.
- Cumul épic intégration : 45 paquets (71→115).

## PAQUET 116 — Cash-control: bucket `other` vs résiduel Z (fix faux positif) (POS-INT-116)
- Bug réel : `reconcileCashControl` comparait toujours le bucket `other` (store_credit/voucher/mobile) à 0 → un jour équilibré payé en partie par avoir client était faussement signalé en écart.
- Fix : `declared other = max(0, totalRevenue − cash − card)` quand `totalRevenueMinorUnits` est connu (sinon 0, comportement legacy conservé). `comptamax.service.buildCashControl` agrège désormais `totalRevenueMinorUnits` depuis `cash_session.closed` et le passe.
- Fichiers : `comptamax/cash-control.ts`, `comptamax.service.ts`, `cash-control.spec.ts` (3 cas : équilibré avec avoir = balanced ; manque sur résiduel = -500 ; legacy sans totalRevenue inchangé).
- Preuve tests : `cash-control.spec.ts` ⇒ 1 suite / 8 tests PASS (verbeux collé).
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette inchangée.

## PAQUET 117 — Cash-control: détail par méthode (POS-INT-117)
- Objectif : aide à l'investigation d'un écart — exposer `capturedByMethod` (capturé agrégé par méthode brute + son bucket), classé par montant décroissant, en plus des 3 buckets.
- Fichiers : `comptamax/cash-control.ts` (type `MethodCapture` + `capturedByMethod` dans `CashControlResult`), `cash-control.spec.ts` (cas : agrégation même méthode + classement + bucket).
- Le service `buildCashControl` renvoie déjà l'objet complet → endpoint enrichi sans changement de contrôleur. CSV inchangé (niveau bucket).
- Preuve tests : `cash-control.spec.ts` ⇒ 1 suite / 9 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette inchangée.

## PAQUET 118 — Event stock.low (rupture imminente) (POS-INT-118)
- Objectif : signal de réappro pour Analytik R — émettre `stock.low` quand 0 < quantité <= seuil d'alerte effectif (POS-083 : CEIL(baseline*0.2) sinon stock_alert_threshold), distinct de `stock.depleted` (=0).
- Fichiers : `common/integration/integration-event.ts` (ajout `stock.low` à l'union), `stock/stock-events.ts` (param `lowStockThreshold`, émission mutuellement exclusive avec depleted, payload porte le seuil), `stock/stock.service.ts` (décrément passe `effectiveAlertThreshold(...)` + type param), `stock-events.spec.ts` (4 cas).
- Sémantique : depleted prioritaire à 0 ; pas de stock.low si seuil absent/≤0 (back-compat) ; best-effort non-bloquant (catch existant).
- Preuve tests : `stock-events.spec.ts` ⇒ 1 suite / 7 tests PASS (verbeux collé).
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 (après fix type param emitStockEvents) ; `nest build` RC=0.
- Dette inchangée. Cumul épic : 48 paquets (71→118).

## PAQUET 119 — Signaux stock + endpoint réappro (POS-INT-119)
- Objectif : vue réappro Analytik R — agréger le feed stock.* (movement/low/depleted) en état latest par produit + statut (ok/low/depleted), classé par urgence ; exposer `GET /integration/stock-signals?date=`.
- Fichiers : `stock/stock-signals.ts` (pur : `summarizeStockSignals`, `toStockSignalEvents`, types), `stock-signals.spec.ts`, `integration/outbox-query.service.ts` (`stockSignalsForDay`), `integration.controller.ts` (route). Tenant-scoped (storeId JWT), réutilise `dayRangeUtc`.
- Robustesse : réappro tardive efface un low/depleted antérieur (latest state) ; tri depleted→low→ok ; tolérant rows hors-type.
- Honnêteté : quantité authoritative = table products ; ceci est une vue consommateur du flux d'events. Logique pure testée ; méthode service = glue lecture-DB validée tsc+build.
- Preuve tests : `stock-signals.spec.ts` ⇒ 1 suite / 7 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Dette inchangée. Cumul épic : 49 paquets (71→119).

## PAQUET 120 — Audit complet + fix 3 specs DI obsolètes (POS-INT-120)
- Contrôle demandé (no blabla, preuves). Run global `src/**` : AVANT = 8 suites rouges. Diagnostic honnête :
  - 5 = gate bcrypt (binaire natif macOS, "invalid ELF header" sur Linux sandbox) : auth.service, employees.service, sales.service.{audit,idempotency,store-credit} — non exécutables ici (env, pas code).
  - 3 = VRAIE régression de tests : reports/returns/stock `.service.spec.ts` non mis à jour après l'ajout de DI intégration (StoreOrgResolver, IntegrationEventEntity) en P79/P86/P89 → "Nest can't resolve dependencies".
- Fix : providers mock ajoutés aux 3 TestingModule (StoreOrgResolver pour reports/returns/stock ; IntegrationEventEntity repo pour stock). Aucun code de prod modifié.
- Preuve APRÈS : `src/**` ⇒ 122 suites PASS / 826 tests PASS, 826/826 ; 5 suites rouges restantes = TOUTES bcrypt (prouvé une par une). 3 suites réparées : 24 tests PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0 (345 .js).
- Audit qualité : 0 TODO/FIXME critiques (csv/integration/comptamax/stock) ; toutes les nouvelles fonctions (stockSignalsForDay, buildCashControl[Csv], shiftsForDayCsv, summarizeStockSignals, cashControlToCsv, buildCashSessionOpenedEvent, csvSafeRow) référencées ≥1 hors def/spec → pas de helper mort.
- Gate bcrypt = nouvelle dette de test environnement (TD-TEST-BCRYPT-NATIVE) : suites bcrypt-dépendantes non exécutables en sandbox ; à lancer sur CI Linux avec bcrypt rebuild.
- Cumul épic : 50 paquets (71→120).

## PAQUET 121 — Mock bcrypt + DI specs ventes → suite backend 0-rouge (POS-INT-121 / TD-TEST-BCRYPT-NATIVE résolu en sandbox)
- Objectif : rendre exécutables les 5 suites bloquées par le binaire natif bcrypt (auth, employees, sales.service.{audit,idempotency,store-credit}).
- Fichiers : `test/mocks/bcrypt.mock.ts` (NOUVEAU, pur : hash/compare/genSalt round-trip base64, hashSync/compareSync, default export), `package.json` jest.moduleNameMapper `^bcrypt$` → mock (test-only), + 3 specs ventes complétées (providers DI manquants : EmployeeEntity repo + StoreOrgResolver — même classe que P120).
- Méthode : mock fidèle (invariant compare(v,hash(v))=true, compare(w,hash(v))=false) → assertions auth/employees/ventes restent valides. Aucun code de prod modifié ; mock non référencé par src/.
- Preuve AVANT : 5 suites rouges (invalid ELF header / DI). APRÈS ciblé : 5 suites / 31 tests PASS.
- Preuve globale : `src/**` ⇒ 127 suites / 857 tests PASS, **0 échec** (vs 122/826 + 5 rouges en P120).
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0 (345 .js).
- Limite restante : suites `test/` (pg/e2e DB) toujours gate DB (pas Postgres en sandbox) ; CI Linux requise pour celles-là.
- Cumul épic : 51 paquets (71→121).

## PAQUET 122 — Cartographie test/ + mock bcrypt réaliste (POS-INT-122)
- Objectif (audit demandé) : cartographier honnêtement les 22 suites `test/` et lever ce qui est réparable.
- Correction mock : `test/mocks/bcrypt.mock.ts` rendu réaliste — format `$2b$<rounds>$<salt22><payload31>` (60 chars, /^\$2[aby]\$\d\d\$/), **sel aléatoire** (hash1≠hash2), `compare` re-dérive le payload (round-trip indépendant du sel). Corrige une régression que mon mock déterministe (P121) introduisait dans `test/auth-security.spec.ts` (assertions format + sel).
- Carte test/ (22 suites) :
  - 11 PURES → PASS : audit, auth-security, currency, loyalty-flow, money-precision, promo, report, sale-m2-hash-fingerprint, sale-transaction, stock, tenant-isolation.
  - 9 pg-mem (in-memory) → PASS en série : avoir-m1-m3, avoir-m5-chain-lock, e2e-money-flow, fiscal-verify, pos-session-db-invariant, pos-session-primitive, ticket-sequence-boundary, void-cash-realized-guard, void-m4-journal-chain.
  - 2 `.pg.spec` → GATE Postgres réel (non exécutables sandbox) : fiscal-e2e.pg, ticket-sequence-boundary.pg.
- Flake identifié (TD-TEST-PARALLEL-REDIS) : sous `--maxWorkers=4`, avoir-m1-m3 + pos-session-db-invariant échouent par contention Redis (ECONNREFUSED 6380, fallback in-memory) ; en `--runInBand` → 20/20 vertes. Reco : pg-mem/DB suites en série ou Redis mické.
- Preuves : auth-security+currency+5 suites P121 ⇒ 7 suites/53 PASS ; 9 autres pures ⇒ 9/97 PASS ; test/ hors .pg en série ⇒ 20 suites/164 PASS. tsc --noEmit EXIT 0.
- Bilan exécutable total : src/** 127 suites/857 + test/ 20 suites/164 = 147 suites / 1021 tests PASS ; seules 2 suites .pg réellement gatées (Postgres).
- Cumul épic : 52 paquets (71→122).

## PAQUET 123 — Neutraliser Redis en test (fix flake) (POS-INT-123)
- Cause : `.env` (chargé par ConfigModule.forRoot en test) définit REDIS_URL=redis://localhost:6380 → ResilientCacheStore tente Redis → flake parallèle (ECONNREFUSED races).
- Fix : `test/jest.setup.ts` (NOUVEAU) `process.env.REDIS_URL=''` + `setupFiles` jest. dotunv ne réécrit pas une clé définie ⇒ factory CacheModule voit '' (falsy) ⇒ InMemoryCacheStore. Test-only, 0 code prod.
- Preuve : bruit Redis (ECONNREFUSED/Redis DOWN) = 0 occurrence ; 2 suites ex-flaky (avoir-m1-m3, pos-session-db-invariant) ⇒ PASS en parallèle ; série complète test/ hors .pg ⇒ 20 suites/164 PASS.
- Limite restante (TD-TEST-DB-SERIAL) : run parallèle des 9 suites pg-mem sature le sandbox (DataSource+pg-mem+modules par suite) → certaines timeout ; toutes vertes en `--runInBand`. Reco CI : suites DB en série (ou workers limités).
- Cumul épic : 53 paquets (71→123).

## PAQUET 124 — Smoke-test routing nouveaux endpoints (POS-INT-124)
- Objectif : prouver que les endpoints P107/P111/P119 délèguent au service avec le storeId du JWT (anti-IDOR, jamais depuis la query) et respectent le switch format.
- Fichiers : `integration.controller.spec.ts` (NOUVEAU : /shifts json+csv, /stock-signals), `comptamax.controller.spec.ts` (NOUVEAU : /cash-control json+csv). Unit pur (services mockés, sans DB/Nest container).
- Preuve tests : 2 suites / 5 tests PASS (verbeux collé : storeId='store-JWT' transmis, csv-variant routé).
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Cumul épic : 54 paquets (71→124).

## PAQUET 125 — Consolidation v7 (santé des tests) (POS-INT-125)
- Agrégat stable : src/** ⇒ 129 suites / 862 tests PASS (maxWorkers=2, 0 échec ; maxWorkers=4 = 3 flakes de contention prouvés PASS en isolation : customers.service, sales.dto, airtable-ops). test/ série hors .pg ⇒ 20 suites / 164 PASS. Total exécutable 149 suites / 1026 tests.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0 (345 .js).
- Doc : §J ajoutée à INTER_SYSTEM_INTEGRATION.md (récap P116–124 + dette test TD-TEST-PG-E2E, TD-TEST-DB-SERIAL).
- Gates : 2 suites .pg (Postgres réel). Reco run : src `--maxWorkers=2`, DB suites `--runInBand`.
- Cumul épic : 55 paquets (71→125).

## PAQUET 126 — Guide test/CI (POS-INT-126)
- Objectif : capturer les modes de run prouvés en un guide actionnable.
- Fichier : `packages/backend/TESTING.md` (NOUVEAU) — 3 groupes (unit `--maxWorkers=2` 129/862 ; pg-mem `--runInBand` 20/164 ; `.pg` via `TEST_DATABASE_URL`), gates bcrypt/Redis, build/typecheck, rappels NF525.
- Correction prouvée : les 2 suites `.pg` se SKIPPENT proprement sans `TEST_DATABASE_URL` (mesuré : 2 skipped / 3 tests skipped) — CI sans Postgres = verte avec skips, jamais rouge. (Le binaire bcrypt mické permet leur chargement → skip propre au lieu d'échec ELF.)
- Preuve : `jest test/*.pg.spec.ts` ⇒ 2 suites skipped, 3 tests skipped.
- Cumul épic : 56 paquets (71→126).

## PAQUET 127 — Fix fuite d'arrondi remboursement partiel (POS-INT-127)
- Bug fiscal réel : `computeLineRefund = round(lineTotal·req/soldQty)` → retours partiels successifs d'une ligne pouvaient sommer ≠ total ligne (ex. 1000 qté3 en 3×1 → 333×3=999, 1 centime non remboursé).
- Fix : arrondi CUMULATIF — refund batch = round(total·(prev+req)/sold) − round(total·prev/sold), `prev`=unités déjà retournées. Σ sur ligne entièrement retournée = total exact, quel que soit le découpage/ordre. Rétro-compatible (prev=0 + retour unique = ancienne valeur ; retour plein = total).
- Fichiers : `returns/returns-policy.ts` (signature +alreadyReturnedQty=0, logique cumulative), `returns.service.ts` (passe `alreadyReturned[li.id]||0`), `returns-policy.spec.ts` (+4 cas : 3×1=1000, tous découpages de qté7=total, back-compat, partiels bornés).
- Preuve tests : returns-policy ⇒ 11 PASS ; non-régression returns.service+refund-events ⇒ 2 suites/21 PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Conformité NF525/comptable : un avoir total sur une ligne rembourse désormais exactement le net payé (pas de fuite centime).
- Cumul épic : 57 paquets (71→127).

## PAQUET 128 — Garde sur-paiement non-espèces (POS-INT-128)
- Risque réel : `changeMinorUnits = paymentTotal − total` était calculé quel que soit le tender → un sur-paiement carte/avoir produisait un "rendu monnaie" espèces = fuite de tiroir-caisse / vecteur de fraude.
- Fix : nouvelle règle `NON_CASH_OVERPAYMENT` — la somme des paiements non-espèces (card, stripe_terminal, store_credit, voucher…) ne doit pas dépasser le total. Seul le cash peut générer du change ⇒ le rendu monnaie est toujours adossé aux espèces.
- Fichiers : `sales/payment-policy.ts` (code + garde + doc), `payment-policy.spec.ts` (+3 cas : carte rejetée, terminal rejeté, cash overpay + carte partielle = change cash-backed).
- Preuve tests : payment-policy ⇒ 10 PASS ; non-régression ventes (audit/idempotency/store-credit) ⇒ 3 suites/14 PASS.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Cumul épic : 58 paquets (71→128).

## PAQUET 129 — AUDIT DE CONTRÔLE blocs 121→128 (Règle 3+4)
Preuves :
- git : branche `recovery/pos-audit-session`, HEAD 82a93fb, arbre PROPRE, 8 commits 121→128.
- typecheck : `tsc --noEmit` EXIT 0.
- build : `nest build` RC=0, 345 .js.
- tests globaux : src/** (maxWorkers=2) ⇒ 129 suites / 869 tests PASS, 0 échec ; test/ série hors .pg ⇒ 20 suites / 164 PASS. Total exécutable 149 suites / 1033 tests.
- TODO/FIXME critiques (zones 121-128) : aucun.
- imports inutilisés (ESLint sur 9 fichiers touchés) : aucun.
- code mort : computeLineRefund (3 réfs), validatePayments (2 réfs) appelés hors def/spec.
- routes exposées : @Get shifts/stock-signals/cash-control présents + controllers enregistrés dans integration.module/comptamax.module.
Cohérence : aucune régression (2 régressions de test antérieures déjà corrigées en P120/P122) ; modules branchés ; pas de doublon logique ; règles métier renforcées (NF525 avoir exact P127, anti-fuite tiroir P128).
VERDICT : ✅ SOLIDE.
Prochains blocs proposés : P130 audit DI cross-module restant (autres *.service.spec non couverts) ; P131 e2e payment-policy via vente (gate pg) ; P132 nouvel axe (loyalty/jackpot) ; P133 consolidation v8 ; P134 README racine état global.

## PAQUET 130 — Audit préventif DI (toutes les *.service.spec) (POS-INT-130)
- Objectif : prévenir une 3ᵉ régression DI (cf. P120/P121) en exécutant TOUTES les suites *.service.spec.
- Résultat : 19/19 suites PASS (moitié 1 : 10 suites/78 tests ; moitié 2 : 9 suites/61 tests = 139 tests), 0 échec DI.
- Méthode : run en 2 moitiés `--maxWorkers=2` (contrainte temps sandbox / TD-TEST-DB-SERIAL).
- Conclusion : aucune dérive DI résiduelle ; les TestingModule sont à jour avec les constructeurs de service actuels.
- Cumul épic : 59 paquets (71→130 ; audits P120/P129/P130 inclus).

## PAQUET 131 — Garde NF525 cohérence total vente (POS-INT-131)
- Objectif (défense-en-profondeur) : garantir runtime que `Σ nets lignes (après promo+remise) === sale.totalMinorUnits`, sinon refuser la vente (fail-closed) plutôt qu'émettre un ticket incohérent.
- Constat : l'invariant tient par construction (promo + distribution remise cumulative) mais n'était gardé par AUCUN check runtime — un refactor futur pourrait le casser silencieusement.
- Fichiers : `sales/sale-total.ts` (NOUVEAU, pur : `sumLineNets`, `assertSaleTotalsConsistent`, `SaleTotalInconsistency`), `sales.service.ts` (garde avant calcul TVA/persistance, mappée BadRequest), `sale-total.spec.ts`.
- Preuve tests : sale-total ⇒ 4 PASS ; non-régression ventes (audit/idempotency/store-credit) ⇒ 3 suites/14 PASS (chemin valide intact). Total 4 suites/18.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Cumul épic : 60 paquets (71→131).

## PAQUET 132 — Anti-IDOR routing endpoints restants (POS-INT-132)
- Objectif : couvrir au smoke-test de routing TOUS les endpoints intégration/comptamax restants (storeId du JWT, jamais query ; switch format/mode).
- Fichiers : `integration.controller.spec.ts` (+events, reconciliation, outbox/stats, relay), `comptamax.controller.spec.ts` (+journal jour/plage/csv, social json/csv).
- Preuve tests : 2 suites / 15 tests PASS (5 P124 + 10 nouveaux) — chaque endpoint délègue avec 'store-JWT' et route correctement jour vs plage vs csv.
- Preuve typecheck/build : `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Couverture anti-IDOR routing : journal, social, cash-control, shifts, stock-signals, events, reconciliation, outbox/stats, relay.
- Cumul épic : 61 paquets (71→132).

## PAQUET 133 — Consolidation v8 (POS-INT-133)
- Agrégat re-prouvé : src/** 130 suites/883 tests + test/ série 20/164 = 150 suites / 1047 tests PASS. tsc EXIT 0 ; nest build RC=0.
- PROJECT_STATUS.md mis à jour (état consolidé daté v8).
- Cumul épic : 62 paquets (71→133).

## PAQUET 134 — stock.low aussi sur adjustStock (parité Analytik R) (POS-INT-134)
- Incohérence trouvée : en P118, `stock.low` n'était câblé que sur le décrément (vente). Une correction d'inventaire manuelle (`adjustStock`) franchissant le seuil bas n'émettait pas `stock.low` (seulement movement/depleted) → angle mort réappro Analytik R.
- Fix : `adjustStock` passe `effectiveAlertThreshold(saved.stockBaselineQuantity, saved.stockAlertThreshold)` à `emitStockEvents` (parité avec la vente). Best-effort post-commit inchangé.
- Fichiers : `stock/stock.service.ts` (1 ligne).
- Preuve tests : stock.service.spec + stock-events.spec ⇒ 2 suites/12 PASS ; `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Cumul épic : 63 paquets (71→134).

## PAQUET 135 — AUDIT DE CONTRÔLE blocs 130→134 (Règle 3+4)
Preuves :
- git : branche recovery/pos-audit-session, HEAD f1fcb1f, arbre PROPRE, commits 131/132/133/134 (+130 audit).
- typecheck : `tsc --noEmit` EXIT 0.
- build : `nest build` RC=0.
- tests : src/** (maxWorkers=2) 130 suites/883 PASS ; test/ série hors .pg 20 suites/164 PASS. Total 150/1047.
- TODO/FIXME (zones 130-134) : aucun.
- imports inutilisés (ESLint) : aucun (exit 0).
- code mort : assertSaleTotalsConsistent (3 réfs), sumLineNets (3 réfs) appelés hors def/spec.
Cohérence : aucune régression ; lacune auto-introduite P118 (stock.low absent sur adjustStock) détectée et corrigée P134 ; garde NF525 total vente (P131) et anti-IDOR routing complet (P132) branchés et testés.
VERDICT : ✅ SOLIDE.
Prochains blocs proposés : P136 audit sync offline (réplay/idempotence) ; P137 currency multi-ligne (précision) ; P138 coupon redemption edge ; P139 consolidation v9 ; P140 nouvel axe.

## PAQUET 136 — Idempotence sync: rejet des ventes sans id (POS-INT-136)
- Bug d'idempotence réel : `push` filtrait `(!s.id || !existing)` → une vente offline SANS id passait toujours et était ré-insérée à chaque replay → DOUBLON monétaire (viole NF525 idempotence).
- Fix : `partitionPushSales` (pur) sépare withId / rejected ; le service n'insère/déduplique que les ventes AVEC id et signale les sans-id en conflit `rejected_no_id` (jamais insérées).
- Fichiers : `sync/conflict.ts` (helper + SyncResolution +rejected_no_id), `sync/sync.service.ts` (wiring + union locale SyncConflict.resolution +rejected_no_id), `conflict.spec.ts` (+3 cas).
- Constat honnête : correction d'un fix bug ; le TS a aussi attrapé un type local divergent (résolu).
- Preuve tests : conflict + sync.service ⇒ 2 suites/12 PASS ; `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Cumul épic : 64 paquets (71→136).

## PAQUET 137 — Fix précision float convertMinor (POS-INT-137)
- Bug réel (mesuré) : `÷10^fromPrec` avant `×rate` injectait une erreur binaire → arrondi .5 vers le bas (107135×1,1 = 117848,5 → 117848 au lieu de 117849). 34 écarts d'1 centime sur 87 594 cas balayés.
- Fix : multiplier le montant ENTIER par le taux d'abord, échelle de précision en un seul facteur : `round(amount × rate × 10^(toPrec−fromPrec))`. Balayage : 0 écart vs référence.
- Fichiers : `currency/convert-amount.ts`, `convert-amount.spec.ts` (+4 cas dont 2 trappes .5, précision 0→2).
- Honnêteté : bug prouvé AVANT correction (script de balayage), corrigé, re-prouvé (0 écart). Conversion = affichage/multi-devises (non-fiscal store currency) mais correctness réelle.
- Preuve tests : convert-amount ⇒ 8 PASS ; `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Cumul épic : 65 paquets (71→137).

## PAQUET 138 — Audit conventions d'arrondi + référence MONEY_ROUNDING (POS-INT-138)
- Vérifs sans fix (sens d'arrondi déjà correct) : `loyaltyPointsEarned` = floor (pas de points indus) ; `computeMaxAllowedDiscount` = floor (cap jamais dépassé) ; `discountPercentOfSubtotal` = display gardé.
- Preuve agrégat helpers monétaires : 11 suites / 93 tests PASS (loyalty, discount-totals, discount-policy, payment-policy, tax, sale-total, returns-policy, promo-discount, convert-amount, consumer-dedup, conflict).
- Livrable : `MONEY_ROUNDING.md` — table des conventions vérifiées + 5 invariants NF525 + récap bugs corrigés (P127/128/136/137).
- Conclusion : surface arrondi/argent saine, conventions documentées et testées.
- Cumul épic : 66 paquets (71→138).

## PAQUET 139 — AUDIT DE CONTRÔLE blocs 136→138 (Règle 3+4)
Preuves :
- git : branche recovery/pos-audit-session, HEAD 985766e, arbre PROPRE, commits 136/137/138.
- typecheck : `tsc --noEmit` EXIT 0 ; build : `nest build` RC=0.
- tests : src/** (maxWorkers=2) 130 suites/890 PASS ; test/ série hors .pg 20 suites/164 PASS. Total 150/1054.
- TODO/FIXME (zones 136-138) : aucun ; imports inutilisés (ESLint) : aucun.
- code mort : partitionPushSales (2 réfs), convertMinor (2 réfs) appelés hors def/spec.
Cohérence : aucune régression ; 2 bugs d'argent corrigés (sync doublon P136, FX off-by-one P137) prouvés avant/après ; audit conventions arrondi documenté (P138).
VERDICT : ✅ SOLIDE.

## PAQUET 140 — Audit interfaces front/back-office + fix page morte (POS-FE-140)
- Direction front/back-office (pas prod). Audit réel câblage écran↔API.
- Défaut critique : `InventoryVariancePage.tsx` orpheline (non routée) importait `stockReconciliationApi` inexistant (api.ts + backend) → `tsc --noEmit` back-office ÉCHOUAIT (front non buildable). Page supprimée (réversible) → tsc EXIT 0.
- Trou majeur documenté : 9 endpoints intégration/comptamax NON câblés au front (0 écran/API/route) → plan P141-144.
- Carte écrans routés établie ; placeholder /timewin24 (ComingSoon) noté.
- Gate : node_modules front hoisté racine → tsc front exécutable (preuve) ; vite build complet non lancé (sandbox).
- Livrables : `FRONT_AUDIT.md` (carte + plan), dette `TD-FRONT-INVENTORY-VARIANCE`.
- Preuve : `tsc --noEmit` back-office EXIT 0 (après retrait).
- Cumul : démarrage axe front (P140).

## PAQUET 141 — API client comptamaxApi + integrationApi (POS-FE-141)
- Objectif : fondation de câblage front des 9 endpoints intégration/comptamax (étaient 0 côté front).
- Fichiers : `backoffice-web/src/services/api.ts` (+`comptamaxApi` {journal, cashControl, social} ; +`integrationApi` {shifts, stockSignals, events, reconciliation, outboxStats, relay}).
- Design : storeId du JWT (anti-IDOR) → aucun param storeId côté client ; `format='csv'|'json'`.
- Preuve : `tsc --noEmit` back-office EXIT 0.
- Suite : P142 page Comptabilité/Intégration consommant ces méthodes.

## PAQUET 142 — Page Comptabilité / Intégration (POS-FE-142)
- Objectif : rendre visible/exploitable le journal compta + le contrôle d'écart de caisse au back-office.
- Fichiers : `pages/AccountingPage.tsx` (NOUVEAU — onglets Journal / Contrôle de caisse ; sélecteur date ; tableau écritures avec totaux + badge équilibré/déséquilibré ; buckets cash/card/other avec écart en rouge ; états vide/chargement/erreur ; export CSV via blob), `main.tsx` (route `/accounting`), `components/Layout.tsx` (nav "Comptabilité", icône Calculator, minRole manager).
- Anti-pattern évité : aucun bouton vers API absente (méthodes P141 réelles) ; storeId du JWT ; messages d'erreur lisibles manager.
- Preuve compile : `tsc --noEmit` back-office EXIT 0.
- Gate environnement (honnête) : `vite build` échoue sur binaire natif `@rollup/rollup-linux-arm64-gnu` absent (node_modules hôte ≠ linux sandbox, bug npm optional-deps) → TD-FE-ROLLUP-NATIVE. Même classe que bcrypt. `tsc` est la preuve de compilation ; build complet à lancer en CI Linux.
- Suite : P143 supervision intégration (sync/outbox/events/reconciliation/stock-signals).

## PAQUET 143 — Page Supervision intégration (POS-FE-143)
- Objectif : exposer l'état d'intégration au siège — file outbox, signaux stock (réappro), rapprochement présence, relais manuel.
- Fichiers : `pages/IntegrationSupervisionPage.tsx` (NOUVEAU — cartes outbox pending/published/failed ; rapprochement POS↔TimeWin avec dégradé ; table signaux stock ok/low/depleted colorée ; bouton "Lancer le relais" réservé admin ; Promise.allSettled → une source HS n'efface pas les autres ; états vide/erreur), `main.tsx` (route `/integration`), `Layout.tsx` (nav "Supervision", icône Activity).
- UX : sources indépendantes (allSettled) ; relais admin-only ; messages lisibles.
- Preuve : `tsc --noEmit` back-office EXIT 0.
- Gate inchangé : vite build = TD-FE-ROLLUP-NATIVE (CI Linux).
- Suite : P144 export CSV shifts + cohérence UX + audit front.

## PAQUET 144 — Export CSV amplitude + cohérence UX + audit front (POS-FE-144)
- Ajout : carte "Amplitude de poste" (totaux minutes/employé) + bouton Export CSV sur la page Supervision (`integrationApi.shifts` json+csv). Shifts intégré au Promise.allSettled (résilient).
- Audit UX (preuves) : 0 page orpheline (toutes les pages routées dans main.tsx) ; 0 appel `*Api.*` vers un objet API absent ; `tsc --noEmit` EXIT 0 (garantit qu'aucun bouton n'appelle un symbole/méthode inexistant).
- Cohérence : exports CSV reliés (journal, cash-control, shifts) ; états vide/erreur lisibles ; relais admin-only.
- Gate inchangé : vite build = TD-FE-ROLLUP-NATIVE (CI Linux). Preuve compile = tsc.
- Bilan front (P140→144) : back-office passé de "ne compile pas" à 2 écrans intégration réels (Comptabilité, Supervision) + API client complet + audit UX propre.

## PAQUET 145 — Audit front caisse (pos-desktop) (POS-FE-145)
- Baseline `tsc --noEmit` pos-desktop EXIT 0 (compile).
- Câblage flux caisse vérifié : vente (Idempotency-Key), paiements (cash/card/mixte/avoir/gift), annulation (void+Idempotency+rights.canVoid+offline), retour/avoir (/returns + /returns/by-ticket), offline/resync (useOfflineMode : enqueue, watcher réseau, sync manuel, bandeaux pending/conflict/sync%), alertes stock (StockAlertToast), garde-fous (SaleGuardsGate), PIN responsable (EmployeePinGate) → TOUS branchés.
- TROU CRITIQUE : remise caisse manuelle — backend POS-054 (cap 30%, PIN responsable 21-30%, motif, audit) prêt mais AUCUNE UI (0 occurrence manualDiscountMinorUnits dans le renderer). Classé TD-FE-MANUAL-DISCOUNT → fix P146.
- Livrable : POS_FRONT_AUDIT.md (table flux↔endpoints + trou).
- Gate : vite build = TD-FE-ROLLUP-NATIVE.

## PAQUET 146 — UI remise responsable (POS-054 branché caisse) (POS-FE-146)
- Comble le trou critique P145 : la remise manuelle caisse a maintenant une UI réelle.
- Fichiers : `components/pos/DiscountModal.tsx` (NOUVEAU — montant €/%, calcul live %, cap 30% bloqué, motif + PIN responsable requis au-delà de 20%, miroir UX de la policy serveur), `stores/posStore.ts` (état `manualDiscount` + `setManualDiscount` + reset clearCart + total() le déduit), `pages/POSPage.tsx` (bouton "Remise responsable" dans le footer panier, rendu modal, payload createSale enrichi `manualDiscountMinorUnits`+`responsablePin`+`justification`, gestion refus 400 = message lisible sans fallback silencieux).
- Sécurité : le SERVEUR reste autoritaire (re-vérifie PIN responsable, cap 30%, motif 21-30% — POS-054) ; l'UI ne fait que collecter et afficher le refus.
- Preuve : `tsc --noEmit` pos-desktop EXIT 0.
- Dette honnête `TD-FE-OFFLINE-DISCOUNT` : remise responsable supportée en ligne (PIN vérifié serveur) ; le payload offline ne la porte pas encore (PIN non vérifiable hors-ligne) — à arbitrer (interdire remise offline vs vérif au sync).
- Gate : vite build = TD-FE-ROLLUP-NATIVE.

## PAQUET 147 — AUDIT DE CONTRÔLE front (blocs 140→146) (Règle 3+4)
Preuves :
- git : branche recovery/pos-audit-session, HEAD 38a2c9d, arbre PROPRE, 7 commits 140→146.
- typecheck : back-office `tsc --noEmit` EXIT 0 ; pos-desktop EXIT 0 ; backend EXIT 0 (non-régression).
- cohérence UX : 0 page orpheline (toutes routées) ; 0 appel `*Api.*` vers objet absent.
- backend sous-jacent : comptamax+integration+discount-policy+payment-policy ⇒ 15 suites / 124 tests PASS.
- écrans livrés : back-office Comptabilité (/accounting) + Supervision (/integration) ; caisse remise responsable (DiscountModal).
- gates honnêtes : vite build = TD-FE-ROLLUP-NATIVE (CI Linux) ; TD-FE-OFFLINE-DISCOUNT ; TD-FRONT-INVENTORY-VARIANCE.
Cohérence : aucune régression ; trou critique back-office (build cassé) corrigé P140 ; épic intégration rendu visible P141-144 ; remise caisse rendue utilisable P145-146.
VERDICT : 🟡 ACCEPTABLE — interfaces réellement exploitables, réserve = preuve runtime visuelle (vite build / e2e) à faire en CI Linux.

## PAQUET 148 — Carte Santé système (back-office) (POS-FE-148)
- Objectif (visibilité siège : erreurs visibles + alertes) : exposer l'état honnête backend (status ok/degraded/down, DB up/latence/erreur, Redis+fallback, TimeWin/circuit-breaker, alertes récentes) sur la page Supervision.
- Fichiers : `services/api.ts` (+`healthApi.check` → /health), `pages/IntegrationSupervisionPage.tsx` (carte "Santé système" en tête ; lecture du body même sur 503 DB-down via reason.response.data ; badges colorés ; liste alertes).
- Résilience : health intégré au Promise.allSettled ; un 503 (DB down) affiche quand même le diagnostic.
- Preuve : `tsc --noEmit` back-office EXIT 0.
- Gate : vite build = TD-FE-ROLLUP-NATIVE.

## PAQUET 149 — Panneau dettes ouvertes & activation prod (back-office) (POS-FE-149)
- Objectif (priorité 1 : affichage clair des dettes ouvertes) : rendre visibles au siège les gates/dettes connus.
- Fichiers : `data/openDebts.ts` (NOUVEAU — liste typée curée : TD-INT-RELAY, TD-INT-SOCIAL-ENTRIES, MIGRATION-1725, TD-FE-OFFLINE-DISCOUNT, TD-FRONT-INVENTORY-VARIANCE, TD-FE-ROLLUP-NATIVE ; sévérité gate/info + impact + action), `pages/IntegrationSupervisionPage.tsx` (carte "Dettes ouvertes & activation prod" avec badges GATE/info, impact, action).
- Honnêteté : liste curée (non live) reflétant EXECUTION_LOG/TECHNICAL_DEBT ; affiche ce qui n'est PAS encore activé/fait.
- Preuve : `tsc --noEmit` back-office EXIT 0 ; 0 page orpheline.
- Priorité 1 siège désormais couverte : intégration visible, états sync, erreurs/alertes (santé), exports, contrôle écart caisse, dettes ouvertes.

## PAQUET 150 — AUDIT + JALON front/back-office (blocs 140→149)
Preuves :
- git : branche recovery/pos-audit-session, HEAD b2a7375, arbre PROPRE.
- typecheck : back-office EXIT 0 ; pos-desktop EXIT 0.
- cohérence : 0 page orpheline ; 0 appel *Api.* vers objet absent ; 2 routes intégration (/accounting, /integration).
Bilan axe front (P140→149) :
- P140 fix build cassé (page morte) ; P141 API client comptamax+integration ; P142 page Comptabilité (journal+écart caisse+CSV) ; P143 page Supervision (outbox/stock/présence/relais) ; P144 amplitude+CSV+audit UX ; P145 audit caisse ; P146 UI remise responsable (POS-054) ; P147 audit front ; P148 carte santé système+alertes ; P149 panneau dettes ouvertes.
- Priorité 1 (siège) couverte : intégration visible, états sync, erreurs/alertes (santé), exports CSV, contrôle écart caisse, dettes affichées.
- Priorité 2 (caisse) : flux déjà branchés + remise responsable ajoutée.
Gates : TD-FE-ROLLUP-NATIVE (build/e2e CI), TD-FE-OFFLINE-DISCOUNT, TD-FRONT-INVENTORY-VARIANCE + dettes backend.
VERDICT : 🟡 ACCEPTABLE — logiciel exploitable siège+magasin ; réserve = preuve runtime build/e2e en CI Linux.

## PAQUET 151 — Helper pur écart d'inventaire (POS-INT-151)
- Objectif : reconstruire proprement l'écart d'inventaire (TD-FRONT-INVENTORY-VARIANCE) SANS table/migration risquée — calcul à la volée, pur, testable.
- Fichier : `stock/stock-variance.ts` (NOUVEAU — `computeStockVariance` : système vs compté, qtyDiff = compté−système, valorisé au coût, statut ok/overage/shortage, totaux manquant/surplus/net, tri par écart valeur décroissant), `stock-variance.spec.ts`.
- Fix : -0 normalisé → 0 (qtyDiff*cost || 0).
- Preuve : `stock-variance.spec.ts` ⇒ 1 suite / 5 tests PASS ; `tsc --noEmit` EXIT 0 ; `nest build` RC=0.
- Suite : P152 endpoint POST /stock/variance (read-only, accepte les comptages, valorise au coût produit).

## PAQUET 152 — Endpoint POST /stock/variance (read-only) (POS-INT-152)
- Fichiers : `stock/stock.service.ts` (`computeVariance` : résout produits par id/ean store-scopé, systemQty=stock, cost=costMinorUnits, applique computeStockVariance, retourne unmatched), `stock/stock.controller.ts` (POST /stock/variance, roles admin/manager, storeId JWT).
- Read-only : aucune mutation de stock, aucune persistance, aucune migration → safe/réversible.
- Preuve : `tsc --noEmit` EXIT 0 ; `nest build` RC=0 ; non-régression stock (variance+service+events) 3 suites/17 tests PASS.
- Suite : P153 API client front + P154 page InventoryVariance reconstruite.

## PAQUET 153 — Écart d'inventaire reconstruit (front, TD-FRONT-INVENTORY-VARIANCE résolu) (POS-FE-153)
- Fichiers : `services/api.ts` (`stockApi.variance(counts)` → POST /stock/variance), `pages/InventoryVariancePage.tsx` (RECONSTRUIT proprement : saisie comptage "EAN;qté" parsée tolérante, appel API, tableau écart système/compté/qté/valeur coloré, totaux comptés/écarts/valeur nette, codes non trouvés signalés, export CSV durci), `main.tsx` (route /inventory-variance), `Layout.tsx` (nav "Écart inventaire", icône ClipboardList, manager).
- Lecture seule : aucune mutation stock. Remplace l'ancien écran mort (P140) par une version branchée et fonctionnelle.
- Preuve : `tsc --noEmit` back-office EXIT 0 ; 0 page orpheline ; 0 appel API absent.
- TD-FRONT-INVENTORY-VARIANCE : résolu (la dette affichée en P149 sera retirée au prochain bloc doc).
- Gate : vite build = TD-FE-ROLLUP-NATIVE.

## PAQUET 154 — Dette résolue retirée + parseCounts extrait/testé (POS-FE-154/155)
- `data/openDebts.ts` : entrée TD-FRONT-INVENTORY-VARIANCE RETIRÉE (résolue P153) → panneau Dettes ouvertes à jour (5 items restants).
- `utils/parseCounts.ts` (NOUVEAU, pur, extrait de la page) + `utils/parseCounts.test.ts` (vitest) ; page consomme l'util (suppression de la copie locale → 0 duplication logique).
- Preuve : `tsc --noEmit` EXIT 0. vitest BLOQUÉ en sandbox (rollup natif `@rollup/rollup-linux-arm64-gnu` MODULE_NOT_FOUND = TD-FE-ROLLUP-NATIVE) → preuve d'exécution alternative : tsc→node sur parseCounts ⇒ **5/5 assertions OK**. Honnêteté : la suite vitest elle-même reste à exécuter en CI Linux.
- Suite : P155 audit de contrôle blocs 151→154 (cohérence back+front, non-régression, verdict).

## PAQUET 155 — AUDIT DE CONTRÔLE blocs 151→154 (Règle 3)
Preuves :
- git : branche `recovery/pos-audit-session`, arbre **propre**, 4 commits f28fded/d9f59d1/8acda6e/12c098c.
- Câblage réel (anti-code-mort) : computeStockVariance importée 1× (service), service.computeVariance appelée par controller 1×, stockApi.variance appelée par page 1×, parseCounts importée par page 1×, InventoryVariancePage routée (main.tsx).
- Compile : backend `tsc --noEmit` EXIT 0 ; back-office `tsc --noEmit` EXIT 0.
- Non-régression backend : `jest src/modules/stock/` ⇒ **6 suites / 37 tests PASS**.
- TODO/FIXME sur le code touché : aucun. Duplication logique : aucune (parseCounts unique, computeStockVariance unique).
- Gate honnête : vite/vitest non exécutables en sandbox (rollup natif) = TD-FE-ROLLUP-NATIVE → preuve node 5/5 fournie pour parseCounts.

VERDICT : ✅ SOLIDE — fonctionnalité écart d'inventaire reconstruite de bout en bout (helper pur → endpoint read-only → écran branché → util testé), compile-verte des 2 packages, non-régression stock prouvée, dette correspondante résolue et retirée de l'app. Réserve unique = preuve runtime visuelle en CI Linux.

## PAQUET 156 — Non-régression GLOBALE backend (agrégat, post écart-inventaire)
Exécution chunkée (budget sandbox), partition vérifiée sans chevauchement (112 modules + 41 hors-modules = 153 = `jest --listTests`) :
- Groupe A (modules a–m) : 37 suites / 256 tests PASS.
- Groupe B (modules n–z) : 75 suites / 502 tests PASS.
- Groupe C (common/database/test) : 39 PASS + 2 skip / 301 PASS + 3 skip.
- TOTAL : **151 suites PASS / 2 skip (153) ; 1059 tests PASS / 3 skip**.
- Les 2 suites skip = `*.pg.spec` (vrai Postgres) auto-skip sans `TEST_DATABASE_URL` (gate honnête documenté TESTING.md).
- Conclusion : ajout `stock-variance` + `computeVariance` + endpoint = **zéro régression** sur l'ensemble du backend (bcrypt mock + Redis off actifs).
- Suite : P157 consolidation docs (PROJECT_STATUS v9, TECHNICAL_DEBT, compteurs).

## PAQUET 157 — Consolidation docs (statut + dette)
- `PROJECT_STATUS.md` : ajout axe interfaces front/back (140→155), TD-FRONT-INVENTORY-VARIANCE marqué RÉSOLU, agrégat P156 (151/2 ; 1059/3), TD-FE-ROLLUP-NATIVE listé.
- `TECHNICAL_DEBT.md` : ligne TD-FRONT-INVENTORY-VARIANCE = ✅ RÉSOLU (preuve commits) ; ligne TD-FE-ROLLUP-NATIVE = Ouvert (CI Linux).
- Cohérence : dette résolue retirée de l'app (openDebts P154) ET marquée résolue dans la doc → pas de divergence app/doc.
- Suite : P158 jalon + verdict + present_files.

## PAQUET 158 — JALON paquet de 8 (151→158) : écart d'inventaire de bout en bout
Livré (8 blocs) :
- P151 helper pur `computeStockVariance` (5 tests) ; P152 endpoint read-only `POST /stock/variance` (roles+JWT storeId, 0 mutation, 0 migration) ; P153 écran InventoryVariancePage reconstruit (saisie comptage, tableau écart valorisé, CSV) routé+nav ; P154 dette résolue retirée de l'app + `parseCounts` extrait/testé (node 5/5) ; P155 audit ✅ SOLIDE ; P156 non-régression globale (151/2 suites ; 1059/3 tests) ; P157 docs ; P158 jalon.
Preuves cumulées : backend tsc EXIT 0, back-office tsc EXIT 0, jest stock 6/37, jest global 151 PASS/2 skip — 1059 PASS/3 skip, git propre, toutes nouvelles fonctions appelées, 0 TODO, 0 duplication.
Réserve honnête unique : build/vitest front = CI Linux (TD-FE-ROLLUP-NATIVE) ; substitut node fourni.

VERDICT : ✅ SOLIDE. Dette TD-FRONT-INVENTORY-VARIANCE résolue. Prochains 5 candidats : (1) build+vitest front en CI Linux (lever TD-FE-ROLLUP-NATIVE), (2) arbitrage TD-FE-OFFLINE-DISCOUNT (remise hors-ligne), (3) export écart→ajustement assisté (avec garde manager), (4) e2e .pg en CI Postgres, (5) polish supervision (filtres/seuils).

## PAQUET 159 — Arbitrage remise responsable HORS-LIGNE (TD-FE-OFFLINE-DISCOUNT)
- Décision : la remise responsable exige une vérif PIN serveur (back 400 si invalide) ; hors-ligne le PIN est invérifiable et la vente devient validée+immuable (NF525) avant tout resync → autorisation invérifiable gravée dans la chaîne. Arbitrage cohérent avec QR/wallet (déjà Internet-only) : **BLOQUER la remise hors-ligne**.
- Fichiers : `renderer/lib/manual-discount-guard.ts` (NOUVEAU, pur `manualDiscountGuard({isOffline})→{allowed,reason}`) + `.test.ts` ; `pages/POSPage.tsx` (bouton désactivé + libellé "hors-ligne indisponible" + message si clic ; garde défensive avant `salesApi.create` si remise présente + offline → refus explicite, pas de fallback silencieux).
- Preuve : `tsc --noEmit` pos-desktop EXIT 0 ; helper node 4/4 (vitest gated TD-FE-ROLLUP-NATIVE) ; câblage : import 1×, guard appelé 2× (bouton + vente).
- Suite : P160 docs (résoudre TD-FE-OFFLINE-DISCOUNT) ; P161 audit+verdict.

## PAQUET 160 — Docs : TD-FE-OFFLINE-DISCOUNT résolue
- `data/openDebts.ts` : entrée TD-FE-OFFLINE-DISCOUNT RETIRÉE (panneau Dettes ouvertes → 4 items).
- `TECHNICAL_DEBT.md` : ligne ✅ RÉSOLU P159 (décision : interdire hors-ligne).
- `PROJECT_STATUS.md` : section arbitrage caisse hors-ligne ajoutée.
- Cohérence app/doc maintenue (retirée de l'app ET marquée résolue).
- Preuve : `tsc --noEmit` back-office EXIT 0.
- Suite : P161 audit de contrôle 159→160 + verdict.

## PAQUET 161 — AUDIT DE CONTRÔLE 159→160 (Règle 3)
Preuves :
- git : arbre propre, commits 7938cb6 (feature) + d91632f (docs).
- Compile : pos-desktop `tsc --noEmit` EXIT 0 ; back-office `tsc --noEmit` EXIT 0.
- Câblage réel : `manualDiscountGuard` importé + appelé 2× (bouton remise + garde validation vente). Helper pur prouvé node 4/4.
- Propreté : 0 TODO/FIXME sur le code touché ; pas de duplication (guard unique).
- Cohérence app/doc : TD-FE-OFFLINE-DISCOUNT retirée du panneau (4 items restants : TD-INT-RELAY, TD-INT-SOCIAL-ENTRIES, MIGRATION-1725, TD-FE-ROLLUP-NATIVE) ET marquée ✅ RÉSOLU dans TECHNICAL_DEBT/PROJECT_STATUS.
- Réserve honnête : vitest non exécutable en sandbox (rollup natif) → preuve node substitut ; suite vitest à lancer en CI Linux.

VERDICT : ✅ SOLIDE — arbitrage hors-ligne décidé (interdire, cohérent NF525) et câblé de bout en bout (helper pur → bouton désactivé + garde défensive validation), compile-vert 2 packages, dette résolue app+doc.
Prochains candidats : (1) build+vitest front en CI Linux (TD-FE-ROLLUP-NATIVE), (2) e2e .pg en CI Postgres, (3) écart→ajustement assisté (garde manager), (4) polish supervision (filtres/seuils), (5) TD-INT-SOCIAL-ENTRIES (décision compta).

## PAQUET 162 — Écart d'inventaire → ajustement assisté (POS-FE-162)
- Boucle fermée : depuis l'écran écart, un manager/admin peut aligner le stock système sur le comptage physique via l'endpoint AUDITÉ `POST /stock/:productId/adjust` (mode `absolute`, motif "Écart inventaire — alignement").
- Fichiers : `services/api.ts` (`stockApi.adjust` accepte `mode?: 'absolute'|'delta'`), `pages/InventoryVariancePage.tsx` (rôle via authStore → colonne Action visible manager/admin ; bouton "Aligner stock" par LIGNE en écart, **confirmation** obligatoire, état aligning/aligné ; lignes sans écart = "—" ; erreur droits surfacée).
- Sécurité : par ligne uniquement (pas de bulk → réversible/contrôlé) ; double garde rôle (front + serveur roles manager/admin) ; écriture audit côté serveur (adjustStock existant) ; aucune migration.
- Honnêteté : l'exécution réelle mute le stock → testable uniquement app+DB lancées ; ici preuve = `tsc --noEmit` EXIT 0 + câblage (0 orphelin / 0 API absente). Pas de mutation déclenchée en sandbox.
- Suite : audit de contrôle.

## PAQUET 163 — AUDIT DE CONTRÔLE 162 (Règle 3)
Preuves :
- git : arbre propre, commit 690b792.
- Câblage : `alignLine`→`stockApi.adjust` 1× ; `window.confirm` 1× (confirmation obligatoire) ; garde `canAdjust` 4× (colonne + bouton + handler).
- Non-régression backend : `jest src/modules/stock/` ⇒ 6 suites / 37 tests PASS (endpoint adjustStock inchangé, réutilisé).
- Sécurité : double garde rôle (front canAdjust + serveur @Roles manager/admin), audit serveur, per-ligne + confirm (pas de bulk), réversible, aucune migration.
- Honnêteté : exécution réelle (mutation stock) non déclenchée en sandbox ; testable app+DB lancées.

VERDICT : ✅ SOLIDE — boucle écart→correction fermée proprement et sûrement (manager only, confirm, audit, réversible). Aucune régression backend.
Prochains candidats : (1) build+vitest+e2e en CI Linux/Postgres (TD-FE-ROLLUP-NATIVE), (2) polish supervision (filtres/seuils), (3) TD-INT-SOCIAL-ENTRIES (décision compta), (4) export écart→ajustement en lot avec double validation.

## PAQUET 164 — Verdict global de supervision (POS-FE-164)
- Polish supervision : bandeau unique en tête (OK vert / À surveiller ambre / Critique rouge) synthétisant santé+outbox+rapprochement+stock → le manager voit l'état d'un coup d'œil au lieu de scanner 6 cartes.
- Échelle : critical (DB/système down, échecs outbox) > watch (dégradé, TimeWin down, file outbox >50, écarts rapprochement, ruptures) > ok ; raisons listées.
- Fichiers : `utils/supervisionVerdict.ts` (NOUVEAU, pur `summarizeSupervision`) + `.test.ts` (vitest) ; `pages/IntegrationSupervisionPage.tsx` (bandeau câblé sur les données déjà chargées).
- Fix : headline via map `Record<VerdictLevel,string>` (tsc narrowing littéral sur ternaire).
- Preuve : `tsc --noEmit` EXIT 0 ; helper node 6/6 (vitest gated TD-FE-ROLLUP-NATIVE) ; importé+utilisé 2× dans la page.
- Suite : audit de contrôle.

## PAQUET 165 — AUDIT DE CONTRÔLE 164 (Règle 3)
- git : arbre propre, commit 12bcb07.
- Compile : back-office `tsc --noEmit` EXIT 0.
- Câblage : `summarizeSupervision` importé + utilisé 2× (calcul + bandeau) ; helper pur node 6/6.
- Cohérence : 0 page orpheline, 0 appel API absent, 0 TODO/FIXME sur les utils touchés.
- Réserve honnête : vitest non exécutable en sandbox (rollup natif) → preuve node substitut ; suites vitest (parseCounts, supervisionVerdict, manual-discount-guard) à lancer en CI Linux.

VERDICT : ✅ SOLIDE — supervision lisible d'un coup d'œil (bandeau verdict synthétique), logique pure testée, 0 régression de cohérence front.
Prochains candidats : (1) build+vitest+e2e en CI Linux/Postgres (lever TD-FE-ROLLUP-NATIVE — seul axe vraiment bloqué en sandbox), (2) TD-INT-SOCIAL-ENTRIES (décision compta), (3) filtres/tri par sévérité dans les listes (signaux stock, écarts), (4) ajustement écart en lot avec double validation.

## PAQUET 166 — CI exécute enfin les tests front (vitest) (POS-CI-166)
- Constat : la CI (.github/workflows/ci.yml) lançait lint + backend tests + 3 builds (vite build = rollup natif OK sur Linux) MAIS jamais les suites vitest front → 9 fichiers de test front (parseCounts, supervisionVerdict, manual-discount-guard, payroll-calculator, export-utils, paymentMachine, hmacSecurity, rightsStore, pointageStore) n'étaient jamais exécutés.
- Fix : 2 steps ajoutés (`npm run test:backoffice`, `npm run test:pos`) + scripts racine `test:backoffice`/`test:pos`/`test:front`.
- Preuve : YAML parse OK (10 steps, dont les 2 front) ; package.json racine parse OK + 3 scripts présents ; tous les scripts référencés par la CI existent.
- Honnêteté : la CI n'est PAS exécutée ici (pas de push externe sans GO) — config validée localement ; les suites vitest tourneront au 1er push (sandbox = rollup natif absent, mais ubuntu-latest l'installe via npm).
- Suite : P167 garde anti-régression de la config CI (test) + P168 helper sévérité, P169 docs, P170 audit.

## PAQUET 167 — Tri par sévérité + filtre écarts (POS-FE-167)
- Fichiers : `utils/severity.ts` (NOUVEAU, pur : `stockSeverityRank`, `sortByStockSeverity` non-mutant, `onlyDiscrepancies`) + `.test.ts` (vitest).
- Câblage : Supervision → signaux stock triés rupture→bas→ok (`sortByStockSeverity`) ; Écart inventaire → case "Afficher les écarts seulement" (`onlyDiscrepancies`).
- Preuve : `tsc --noEmit` EXIT 0 ; severity node 9/9 (vitest gated, lancé en CI depuis P166) ; importé dans 2 pages.
- Suite : P168 hygiène/vérif, P169 docs CI + dette, P170 audit.

## PAQUET 168 — Docs CI + dette rollup couverte (POS-CI-168)
- `packages/backend/TESTING.md` : section CI ajoutée (5 étapes : lint, backend, backoffice vitest, pos vitest, builds) + explication binaire rollup Linux.
- `TECHNICAL_DEBT.md` : TD-FE-ROLLUP-NATIVE passé 🟡→🟢 "Couvert en CI" (reste non exécutable bac à sable arm64).
- `openDebts.ts` (panneau app) : reformulé "Build + tests front (CI)", action = vérifier 1er run vert.
- Preuve : `tsc --noEmit` back-office EXIT 0 (openDebts modifié).
- Honnêteté : "couvert en CI" = câblé ; le 1er run réel reste à observer au prochain push (pas de push externe sans GO).
- Suite : P169 sweep non-régression front+backend, P170 audit+verdict.

## PAQUET 169 — GATE FRONT LEVÉ EN VRAI (TD-FE-ROLLUP-NATIVE résolu)
- Cause racine : bac à sable arm64 Linux, binaire optionnel `@rollup/rollup-linux-arm64-gnu` absent → vite/vitest échouaient.
- Action : `npm i -D @rollup/rollup-linux-arm64-gnu --no-save` (optionnel par-arch, npm choisit le bon binaire sur chaque plateforme ; non figé dans package.json pour ne pas casser la CI x64).
- PREUVE RÉELLE (plus de substitut node) :
  - vitest backoffice : 5 fichiers / **19 tests PASS** (parseCounts, severity, supervisionVerdict, export-utils, payroll-calculator).
  - vitest pos-desktop : 5 fichiers / **23 tests PASS** (paymentMachine, pointageStore, rightsStore, hmacSecurity, manual-discount-guard).
  - `vite build` backoffice : 1988 modules, built 2.41s, RC 0.
  - `vite build` pos-desktop : 2082 modules, built 2.91s, RC 0.
- Total front : **10 fichiers / 42 tests vitest PASS + 2 builds verts** — confirme a posteriori la justesse des preuves node des paquets précédents.
- Docs : TECHNICAL_DEBT TD-FE-ROLLUP-NATIVE = ✅ RÉSOLU ; retiré du panneau Dettes ouvertes (`tsc` EXIT 0).
- Suite : P170 audit de contrôle 166→169 + verdict.

## PAQUET 170 — AUDIT DE CONTRÔLE 166→169 (Règle 3)
Preuves :
- git : arbre propre, 4 commits 9458e54/056fa6f/c2ddc59/ea2d3d8.
- Compile : backend + back-office + pos-desktop `tsc --noEmit` = **EXIT 0** (les 3).
- Tests front RÉELS : vitest 10 fichiers / **42 tests PASS** ; `vite build` ×2 verts (P169).
- CI : steps front câblés (P166), TESTING.md à jour (P168).
- Câblage : severity importé 2 pages, summarizeSupervision 2×, filtre/sort fonctionnels.
- Cohérence app/doc : panneau Dettes ouvertes = 3 items, tous gates infra réels (TD-INT-RELAY = secrets+URL, TD-INT-SOCIAL-ENTRIES = décision compta, MIGRATION-1725 = DB cible). Plus aucune dette front.

VERDICT : ✅ SOLIDE — la dernière réserve "sandbox" (TD-FE-ROLLUP-NATIVE) est LEVÉE et prouvée (42 tests vitest + 2 builds), pas seulement configurée. Reste 3 gates 100% infra (secrets / décision métier / base prod) — hors périmètre sans GO explicite.
Prochains candidats (tous gated, nécessitent une décision/un accès) : (1) TD-INT-RELAY (fournir OUTBOX_PUBLISH_URL+SECRET), (2) TD-INT-SOCIAL-ENTRIES (validation plan de comptes social), (3) MIGRATION-1725 (migration:run base cible hors prod), (4) e2e Playwright en CI.

## PAQUET 171 — Preuve loopback du publisher HTTP outbox (TD-INT-RELAY dé-risqué)
- `modules/integration/outbox-publisher.spec.ts` (NOUVEAU) : prouve les mécaniques de livraison du `HttpOutboxPublisher` contre un serveur localhost (aucun secret réel, aucun push externe).
- Couvre : (1) POST signé reçu → le receveur re-vérifie le HMAC sur le corps exact = 'ok', enveloppe + headers x-pos-* corrects, retour true sur 2xx ; (2) non-2xx → false (dead-letter) ; (3) corps altéré → 'bad_signature' (intégrité) ; (4) factory = Simulation si env absent, Http seulement si URL+SECRET présents.
- Preuve : `jest outbox-publisher.spec.ts` ⇒ 1 suite / **5 tests PASS** (exécution réelle, serveur http loopback).
- Honnêteté : TD-INT-RELAY reste gated en prod (URL + secret réels à fournir) — mais les mécaniques (POST + signature + verdict + gate env) sont désormais PROUVÉES, plus seulement câblées.
- Suite : P172 non-régression suite intégration, P173 docs dette, P174/175 audit.

## PAQUET 172 — Non-régression suite intégration
- `jest src/modules/integration src/common/integration` ⇒ **10 suites / 72 tests PASS** (relayOutcome, isEligibleForRelay, backoff, publishEnvelope/sign/verify, buildOutboxPublishRequest, keyset/cursor, reconciliation, controller, **outbox-publisher loopback**).
- Conclusion : ajout du test loopback = 0 régression sur l'épic intégration ; mécaniques de bout en bout couvertes.
- Suite : P173 docs dette relais, P174/175 audit + verdict.

## PAQUET 173 — Docs : TD-INT-RELAY mécaniques prouvées (reste gated secrets)
- `openDebts.ts` : impact reformulé "Mécaniques POST+signature prouvées (loopback P171) ; simulation seule tant que URL/secret réels absents". Sévérité reste `gate` (secrets requis).
- `TECHNICAL_DEBT.md` : ligne TD-INT-RELAY ajoutée (🟡, preuve loopback 5 tests, action = fournir secrets).
- Preuve : `tsc --noEmit` back-office EXIT 0.
- Honnêteté : NON résolu — la livraison réelle exige URL+secret de prod (hors sandbox). Seules les mécaniques sont prouvées.
- Suite : P174 non-régression globale rapide, P175 audit+verdict.

## PAQUET 174 — Non-régression GLOBALE backend (re-agrégat post loopback)
Partition vérifiée (113 modules + 41 hors-modules = 154 = `jest --listTests`) :
- A (a–m, intégration incluse) : 38 suites / 261 tests PASS.
- B (n–z) : 75 suites / 502 tests PASS.
- C (common/db/test) : 39 PASS + 2 skip / 301 PASS + 3 skip.
- TOTAL : **152 suites PASS / 2 skip (154) ; 1064 tests PASS / 3 skip**.
- Δ vs P156 : +1 suite / +5 tests = exactement le spec loopback (P171). 2 skip = `.pg.spec` (Postgres, gate). Zéro régression.
- Suite : P175 audit de contrôle 171→174 + verdict.

## PAQUET 175 — AUDIT DE CONTRÔLE 171→174 (Règle 3)
Preuves :
- git : arbre propre, commits 49537d5/584dbbb/5eb2568/23d3ccf.
- Compile : backend + back-office + pos-desktop `tsc --noEmit` = EXIT 0 (les 3).
- Tests : loopback publisher 5/5 (P171) ; suite intégration 10/72 (P172) ; global backend 152 suites PASS/2 skip — 1064 tests PASS/3 skip (P174, +5 = loopback, 0 régression).
- Cohérence app/doc : panneau = 3 gates infra ; TD-INT-RELAY impact mis à jour (mécaniques prouvées) + ligne TECHNICAL_DEBT ajoutée.
- Bundle : history complète vérifiée.

VERDICT : ✅ SOLIDE — le relais HTTP outbox n'est plus "câblé sans preuve" : livraison signée + vérification receveur + intégrité (tamper) + gate factory sont PROUVÉS de bout en bout en loopback (sans secret ni push externe). Reste 3 vraies gates : TD-INT-RELAY (secrets/URL prod), TD-INT-SOCIAL-ENTRIES (décision compta), MIGRATION-1725 (Postgres — non root en sandbox).
Prochains candidats (tous nécessitent accès/décision) : (1) fournir OUTBOX_PUBLISH_URL+SECRET (activer relais réel), (2) valider plan de comptes social, (3) migration:run sur base cible, (4) e2e Playwright en CI.

## PAQUET 176 — MIGRATION-1725 dé-risquée sur pg-mem (POS-INT-176)
- `test/migration-1725-outbox.spec.ts` (NOUVEAU) : applique `up()`/`down()` de la migration contre pg-mem (Postgres en mémoire).
- Prouve : up() crée `integration_events` avec les 17 colonnes attendues ; défauts appliqués à l'INSERT (status='pending', attempts=0, schema_version=1) ; down() drop la table (réversible).
- Non prouvé (limite pg-mem, honnête) : idempotence `CREATE TABLE IF NOT EXISTS` sur table existante (feature Postgres réel, non modélisée en mémoire) → validée au migration:run prod.
- Preuve : `jest migration-1725-outbox.spec.ts` ⇒ 1 suite / **3 tests PASS**.
- Statut MIGRATION-1725 : SQL prouvé bien formé + schéma conforme ; reste gated sur base cible réelle (Neon, hors sandbox non-root).
- Suite : P177 non-régression, P178 docs, P179/180 audit.

## PAQUET 177 — Parité entité ↔ migration integration_events (anti-drift)
- Comparaison colonnes : migration 1725 (17) vs `integration-event.entity.ts`.
- 16 colonnes matchées via `name:` ; la 17e (`id`) = `@PrimaryColumn({type:'uuid'})` (nom par défaut `id`, non capté par le grep name:) → présente des 2 côtés.
- Résultat : **0 drift** — schéma migration == schéma entité. Le test pg-mem (P176) + le test loopback (P171) + cette parité couvrent l'outbox de bout en bout (schéma, persistance défauts, livraison signée).
- Suite : P178 docs, P179 non-régression test/, P180 audit+verdict.

## PAQUET 178 — Docs : MIGRATION-1725 SQL prouvé (reste gated base)
- `openDebts.ts` : impact reformulé "SQL up()/down() prouvé (pg-mem P176) + parité entité (P177)". Sévérité reste `gate` (base cible requise).
- `TECHNICAL_DEBT.md` : ligne MIGRATION-1725 ajoutée (🟡, preuves P176/P177, action migration:run base cible).
- Preuve : `tsc --noEmit` back-office EXIT 0.
- Suite : P179 non-régression test/, P180 audit+verdict.

## PAQUET 179 — Non-régression dossier test/ (hors modules)
- `jest` hors-modules ⇒ **40 suites PASS + 2 skip / 42** ; **304 tests PASS + 3 skip / 307**.
- Δ vs P174 : +1 suite / +3 tests = spec migration 1725 (P176). 2 skip = `.pg.spec` (Postgres).
- Global backend recalculé : A 38/261 + B 75/502 + C 40+2skip/304+3skip = **153 suites PASS / 2 skip (155) ; 1067 tests PASS / 3 skip**. Zéro régression.
- Suite : P180 audit de contrôle 176→179 + verdict.

## PAQUET 180 — AUDIT DE CONTRÔLE 176→179 (Règle 3)
Preuves :
- git : arbre propre, commits efbdd2b/cba3bbc/2cc0af9/eb89baf.
- Compile : backend + back-office + pos-desktop `tsc --noEmit` = EXIT 0 (les 3).
- Tests : migration 1725 pg-mem 3/3 (P176) ; parité entité 17 col 0 drift (P177) ; global backend 153 suites PASS/2 skip — 1067 tests PASS/3 skip (P179, +3 = migration, 0 régression).
- Cohérence app/doc : impacts MIGRATION-1725 + TD-INT-RELAY mis à jour (mécaniques/SQL prouvés) ; lignes TECHNICAL_DEBT ajoutées. Panneau = 3 gates infra (inchangé, statuts affinés).
- Bundle : history complète.

VERDICT : ✅ SOLIDE — les 3 gates restantes ne sont plus des boîtes noires : TD-INT-RELAY (livraison signée prouvée loopback), MIGRATION-1725 (SQL up/down + schéma prouvés pg-mem + parité entité), TD-INT-SOCIAL-ENTRIES (reste une décision compta). Chacune est câblée + prouvée au maximum possible sans franchir le gate réel (secrets / base Postgres serveur / validation métier).
Prochains (nécessitent accès/décision hors sandbox) : (1) OUTBOX_PUBLISH_URL+SECRET → activer relais réel, (2) migration:run sur Neon, (3) plan de comptes social validé, (4) e2e Playwright/CI.

## PAQUET 181 — Audit stubs/placeholders + retrait champ mort SalesCockpit
- Balayage repo (TODO/FIXME/stub/placeholder/not implemented) : la plupart = `placeholder` d'inputs (légitimes). Vrais items : (a) `customers.service.ts` TODO Redis multi-instance = limite infra documentée (env REDIS_URL) → laissée telle quelle ; (b) `reports` "sending to Comptamax24 not implemented" = TD-INT-RELAY (déjà tracké) ; (c) **`SalesCockpit.tsx` `vsYesterday`/`vsLastWeek` = champs déclarés, forcés à null, JAMAIS rendus** → stub.
- Fix : suppression des 2 champs morts (interface + assignations) + TODO trompeur. Aucune UI ne les affichait (grep = 0 usage ailleurs). Note : le backend `reports` expose déjà les comparaisons J-1/S-1 (TrendComparisons) → une vraie feature "vs hier" reste possible plus tard (front à câbler+rendre), mais ne doit pas rester en stub mort.
- Preuve : `tsc --noEmit` pos EXIT 0 ; vitest pos 5 fichiers / **23 tests PASS** (0 régression) ; 0 référence résiduelle vsYesterday/vsLastWeek.

VERDICT : ✅ SOLIDE — un stub mort de moins ; caisse cockpit sans champ trompeur. Autres "placeholders" détectés = inputs légitimes ou dettes infra déjà trackées.
Reste : 3 gates infra (TD-INT-RELAY secrets, MIGRATION-1725 base, TD-INT-SOCIAL-ENTRIES décision). Proposition future non-gated : câbler réellement "CA vs hier" au cockpit depuis l'endpoint reports existant (feature front complète).

## PAQUET 182 — Hygiène prop morte + constat "vs hier" déjà branché
- Constat : la feature "CA vs hier" existe DÉJÀ proprement en back-office (`ProductPerformancePage` : cartes vs J-1/S-1/M-1/N-1 via endpoint `reports/sales-trend`, `deltaPct` calculé serveur). Comparaison honnête (journée partielle vs jours complets, étiquetée). → Mon retrait du stub cockpit (P181) était le bon geste ; rien à re-câbler.
- Fix hygiène : prop `today` de `CaCompareCard` passée aux 4 appels mais JAMAIS utilisée (le delta vient du serveur) → retirée (signature + 4 appels).
- Preuve : `tsc --noEmit` back-office EXIT 0 ; vitest back-office 5 fichiers / **19 tests PASS** (0 régression).

VERDICT : ✅ SOLIDE — code front encore plus propre (prop morte éliminée), feature de comparaison confirmée déjà opérationnelle au bon endroit. Aucune nouvelle dette.
Reste inchangé : 3 gates infra (secret relais / base migration / décision compta) — seuls axes nécessitant un accès ou une décision externe.

## PAQUET 183 — Extraction + test JWT Wesley Club (buildMobileTokens) — sécurité
- `mobile-auth/mobile-tokens.ts` (NOUVEAU, pur) : `buildMobileTokens(subject, accessSecret, refreshSecret)` — audience `mobile-app`, TTL 15m/30j, PIÈGE `aud` évité (jamais dans le payload, uniquement via option — cf. CLAUDE.md security rule 5).
- `mobile-auth.service.ts` re-câblé (comportement préservé) : `buildAuthResponse` délègue au helper ; constante `MOBILE_AUDIENCE` réutilisée dans `refresh()`.
- `mobile-tokens.spec.ts` : 5 tests — pas de throw (anti-aud), access porte aud/sub/email + vérif OK, refresh signé avec le secret refresh (le secret access ne le vérifie PAS), mauvaise audience rejetée, TTL access=900s / refresh=2592000s.
- Preuve : `tsc --noEmit` EXIT 0 ; `jest mobile-tokens.spec.ts` ⇒ 1 suite / **5 tests PASS** ; service utilise le helper.
- Valeur : couvre un chemin auth client jusque-là sans spec + verrouille la non-régression du piège aud (throw runtime documenté).
- Suite : P184 non-régression mobile-auth + global, P185 docs, P186/187 audit.

## PAQUET 184 — Non-régression auth après re-câblage mobile-tokens
- `jest src/modules/mobile-auth test/auth-security.spec.ts` ⇒ **2 suites / 16 tests PASS**.
- Confirme : l'extraction du helper JWT n'altère pas le contrat auth (audience mobile-app, isolation secrets, garde rôles). Comportement du service préservé.
- Suite : P185 non-régression globale (nouveau spec inclus), P186 docs, P187 audit.

## PAQUET 185 — Non-régression GLOBALE backend (re-agrégat post mobile-tokens)
Partition (114 modules + 42 hors-modules = 156 = `jest --listTests`) :
- A (a–m, mobile-auth inclus) : 39 suites / 266 tests PASS.
- B (n–z) : 75 suites / 502 tests PASS.
- C (common/db/test) : 40 PASS + 2 skip / 304 PASS + 3 skip.
- TOTAL : **154 suites PASS / 2 skip (156) ; 1072 tests PASS / 3 skip**.
- Δ vs P179 : +1 suite / +5 tests = spec mobile-tokens (P183). 2 skip = `.pg.spec`. Zéro régression.
- Suite : P186 docs (TESTING), P187 audit+verdict.

## PAQUET 186 — Doc TESTING (garde sécurité auth mobile)
- `TESTING.md` : section "Sécurité auth mobile (Wesley Club)" ajoutée (contrat JWT + total 154/1072).
- Suite : P187 audit de contrôle 183→186 + verdict.

## PAQUET 187 — AUDIT DE CONTRÔLE 183→186 (Règle 3)
Preuves :
- git : arbre propre, commits 43d0556/2d42f73/b782eda/1d15381.
- Compile : backend `tsc --noEmit` EXIT 0 + `nest build` RC 0.
- Câblage : `buildMobileTokens` utilisé 3× dans le service ; **0 `jwt.sign` restant dans le service** (toute la construction JWT est passée au helper pur testé).
- Tests : mobile-tokens 5/5 (P183) ; auth non-régression 16 (P184) ; global 154 suites PASS/2 skip — 1072 tests PASS/3 skip (P185, +5, 0 régression).
- Bundle : history complète.

VERDICT : ✅ SOLIDE — un chemin auth client (Wesley Club JWT) jusque-là sans test est désormais couvert par un helper pur + 5 tests verrouillant le contrat (audience, TTL, isolation secrets, anti-`aud`). Refactor à comportement préservé, 0 régression globale.
Reste inchangé : 3 gates infra (secret relais / base migration / décision compta). Autres services sans spec colocated (connected-apps, terminals, airtable-ops) = candidats pour de prochains paquets couverture (non-gated).

## PAQUET 188 — Test AirtableOpsMapper (sécurité import : prix/stock = high) (POS-AIRTABLE-188)
- `airtable-ops/airtable-ops.mapper.spec.ts` (NOUVEAU) : couvre le mapper pur jusque-là sans spec.
- Export POS→Airtable : mapping des champs (POS_ID/EAN/prix/coût/stock/…), défauts (coût null, description/image → '').
- Import Airtable→POS (propositions) : SEO/copy = risk `low` ; validation/isActive = `medium` ; **PRIX et STOCK = risk `high` TOUJOURS** (invariant sécurité : jamais auto-appliqué) ; aucune op si valeur inchangée ; import vide → [].
- Preuve : `jest airtable-ops.mapper.spec.ts` ⇒ 1 suite / **8 tests PASS** ; `tsc --noEmit` EXIT 0.
- Valeur : verrouille l'invariant "changement financier = validation manuelle obligatoire" du connecteur Airtable.
- Suite : P189 non-régression module + global, P190 docs, P191 audit.

## PAQUET 189 — Non-régression GLOBALE backend (re-agrégat post airtable-mapper)
Partition (115 modules + 42 hors-modules = 157 = `jest --listTests`) :
- A (a–m, airtable-ops inclus) : 40 suites / 274 tests PASS.
- B (n–z) : 75 suites / 502 tests PASS.
- C (common/db/test) : 40 PASS + 2 skip / 304 PASS + 3 skip.
- TOTAL : **155 suites PASS / 2 skip (157) ; 1080 tests PASS / 3 skip**.
- Δ vs P185 : +1 suite / +8 tests = spec airtable mapper (P188). Zéro régression.
- Suite : P190 docs, P191 audit+verdict.

## PAQUET 190 — Doc TESTING (connecteur Airtable) + total corrigé
- `TESTING.md` : section "Sécurité connecteur Airtable" (invariant prix/stock=high) ; total corrigé 155/1080.
- Suite : P191 audit de contrôle 188→190 + verdict.

## PAQUET 191 — AUDIT DE CONTRÔLE 188→190 (Règle 3)
Preuves :
- git : arbre propre, commits 6196b55/e6151ee/1847687.
- Anti-code-mort : `productToAirtable` appelé 1× + `airtableToProductOperations` appelé 1× par `airtable-ops.sync.service.ts` → le mapper testé est réellement utilisé (pas un test sur du code mort).
- Compile : backend `tsc --noEmit` EXIT 0 + `nest build` RC 0.
- Tests : mapper 8/8 (P188) ; global 155 suites PASS/2 skip — 1080 tests PASS/3 skip (P189, +8, 0 régression).
- Bundle : history complète.

VERDICT : ✅ SOLIDE — le connecteur Airtable (mapper export + classification de risque à l'import) est désormais couvert, avec verrouillage de l'invariant sécurité "prix/stock = high, jamais auto-appliqué". Code réellement branché, 0 régression.
Bilan couverture (183→190) : 2 modules sécurité-sensibles jusque-là sans spec (mobile-auth JWT, airtable mapper) désormais testés. Restent sans spec colocated : connected-apps + terminals (CRUD/repo, peu de logique pure — testables via DI si souhaité). Gates infra inchangées (relais/migration/social).

## PAQUET 192 — Suppression du doublon mort guards/permissions.ts (POS-192)
- Audit couverture : `common/guards/permissions.ts` (hasMinRole + ROLE_HIERARCHY + ROLE_ALIASES) **importé par PERSONNE** → code mort dupliquant `role-hierarchy.ts` (canonique, déjà testé roleLevel/roleSatisfies + roles.guard).
- Action : matrice de permissions (doc utile) déplacée dans `role-hierarchy.ts` (au-dessus du code qui l'implémente) ; `permissions.ts` supprimé.
- Preuve : `tsc --noEmit` EXIT 0 (rien ne dépendait du fichier) ; `jest src/common/guards` ⇒ 2 suites / 16 tests PASS ; `nest build` RC 0.
- Valeur : -1 fichier mort, -1 duplication de la hiérarchie de rôles (source de vérité unique = role-hierarchy.ts), doc de permissions préservée au bon endroit.
- Suite : P193 non-régression global, P194 docs, P195 audit.

## PAQUET 193 — Non-régression globale (post suppression permissions.ts)
- A (a–m) : 40 suites / 274 tests PASS ; C (hors modules, guards inclus) : 40 PASS + 2 skip / 304 PASS + 3 skip — identiques à P189. B (n–z) inchangé depuis P189 (75/502, aucune modif n-z).
- TOTAL : **155 suites PASS / 2 skip (157) ; 1080 tests PASS / 3 skip** — inchangé : la suppression du fichier mort n'a impacté aucun test (confirme qu'il était bien du code mort).
- Suite : P194 docs, P195 audit+verdict.

## PAQUET 194 — Docs cohérence post-suppression
- Vérif : aucun fichier de pilotage (.md hors EXECUTION_LOG) ne référençait `guards/permissions.ts` → rien à corriger.
- `TECHNICAL_DEBT.md` : section "Dette résolue (traçabilité)" ajoutée avec TD-DEAD-PERMISSIONS (supprimé P192, matrice préservée, 0 régression).
- Suite : P195 audit de contrôle 192→194 + verdict.

## PAQUET 195 — AUDIT DE CONTRÔLE 192→194 (Règle 3)
Preuves :
- git : arbre propre, commits 32d5a68/6ad92bc/97296b0.
- Nettoyage : 0 référence résiduelle à `guards/permissions'` ou `hasMinRole` dans le code ; matrice de permissions préservée dans `role-hierarchy.ts`.
- Compile : backend `tsc --noEmit` EXIT 0 + `nest build` RC 0.
- Non-régression : 155 suites PASS/2 skip — 1080 tests PASS/3 skip (P193, inchangé → 0 impact).
- Bundle : history complète.

VERDICT : ✅ SOLIDE — un fichier de code mort supprimé (doublon de la hiérarchie de rôles), source de vérité unique consolidée (role-hierarchy.ts, testé), doc de permissions préservée, 0 régression. Hygiène + sécurité (un seul point de décision pour les rôles).
Bilan couverture/hygiène (183→194) : mobile-auth JWT testé, airtable mapper testé, permissions.ts mort supprimé. Restent sans spec colocated : connected-apps + terminals (CRUD/repo). Gates infra inchangées.

## PAQUET 196 — Suppression composants morts supplantés (Store/App switchers)
- Audit front code-mort : `components/StoreSwitcher.tsx` (105 l) et `components/AppSwitcher.tsx` (84 l) = 1 occurrence chacun (leur propre déf) → jamais montés.
- Diagnostic : StoreSwitcher **supplanté** par le "Scope Switcher" inline du `Layout` (Vue Globale + magasins, admin) ; AppSwitcher = bascule pos/timewin24, hors périmètre back-office (TimeWin24 = future app iPhone V3). Deux composants morts/supplantés.
- Action : suppression des 2 fichiers.
- Preuve : `tsc --noEmit` EXIT 0 (rien ne les importait) ; vitest 5 fichiers / **19 tests PASS**.
- Suite : P197 brancher `safeErrorMessage` (util défensif inutilisé) sur les points d'erreur bruts, P198 non-régression, P199 docs, P200 audit.

## PAQUET 197 — safeErrorMessage branché + testé (util défensif, POS-FE-197)
- `utils/safeErrorMessage.ts` était orphelin (0 usage) — util anti-crash React #310 (objet rendu comme enfant).
- Test : `safeErrorMessage.test.ts` (4 tests) — string, string[] joint, objet → JSON string (anti-crash), fallback err.message puis défaut.
- Câblage : `ProductsPage` (2 spots : setError chargement + alert sauvegarde, remplace les extractions manuelles dupliquées) et `ConnectedAppsPage` (setError). L'util passe d'orphelin à utilisé (2 pages).
- Preuve : `tsc --noEmit` EXIT 0 ; vitest 6 fichiers / **23 tests PASS** (dont safeErrorMessage 4/4).
- Suite : P198 non-régression vitest complète, P199 docs, P200 audit.

## PAQUET 198 — Non-régression front consolidée
- back-office : `tsc --noEmit` EXIT 0 ; vitest 6 fichiers / **23 tests PASS**.
- pos-desktop : `tsc --noEmit` EXIT 0.
- Vérif : StoreSwitcher/AppSwitcher supprimés ; safeErrorMessage utilisé dans 2 pages (plus orphelin).
- Bilan front (196→198) : -2 composants morts, +1 util défensif branché+testé, 0 régression.
- Suite : P199 docs, P200 audit+verdict.

## PAQUET 199 — Docs traçabilité dette front résolue
- `TECHNICAL_DEBT.md` : TD-FE-DEAD-SWITCHERS (✅ supprimés P196) + TD-FE-ORPHAN-UTIL (✅ safeErrorMessage branché+testé P197) ajoutés à la section "Dette résolue".
- Suite : P200 audit de contrôle 196→199 + verdict.

## PAQUET 200 — AUDIT DE CONTRÔLE 196→199 (Règle 3)
Preuves :
- git : arbre propre, commits b479638/30cb567/b2c204c/5c83abf.
- Nettoyage : re-sweep back-office = **0 fichier orphelin restant** (StoreSwitcher/AppSwitcher supprimés, safeErrorMessage désormais importé).
- Compile : back-office `tsc --noEmit` EXIT 0 + vitest 6 fichiers/23 tests ; pos-desktop `tsc --noEmit` EXIT 0 (P198).
- Cohérence app/doc : dettes front résolues tracées (TD-FE-DEAD-SWITCHERS, TD-FE-ORPHAN-UTIL).
- Bundle : history complète.

VERDICT : ✅ SOLIDE — front assaini : 2 composants morts supplantés supprimés (-189 lignes), 1 util défensif anti-crash React branché + testé (orphelin → utilisé). 0 orphelin restant en back-office. 0 régression (tsc ×2 verts, vitest 23).
Bilan hygiène/couverture cumulé (183→199) : mobile-auth JWT testé, airtable mapper testé, guards/permissions doublon supprimé, 2 switchers morts supprimés, safeErrorMessage branché+testé. Gates infra inchangées (relais/migration/social).

## PAQUET 201 — JALON : agrégat backend global autoritaire
- A (a–m) 40/274 + B (n–z) 75/502 + C (hors modules) 40+2skip/304+3skip.
- TOTAL backend : **155 suites PASS / 2 skip (157) ; 1080 tests PASS / 3 skip** (2 `.pg.spec` = Postgres réel, gate).
- Partition vérifiée = 157 = `jest --listTests`. Aucune régression.
- Suite : P202 preuve front complète (vitest + builds), P203/204 rafraîchissement pilotage, P205 audit jalon.

## PAQUET 202 — JALON : preuve front complète (vitest + builds)
- vitest back-office : 6 fichiers / **23 tests PASS**.
- vitest pos-desktop : 5 fichiers / **23 tests PASS**.
- Total front : **11 fichiers / 46 tests vitest PASS**.
- `vite build` back-office : 1989 modules, built ~2.4s, RC 0.
- `vite build` pos-desktop : voir ci-dessus (RC 0).
- Gate TD-FE-ROLLUP-NATIVE levé (binaire arm64 présent) → tout le front exécutable en sandbox + CI.

## PAQUET 203 — Rafraîchir PROJECT_STATUS (chiffres autoritaires v9)
- État consolidé mis à jour au jalon PAQUET 202 : backend 155/2 skip (157) · 1080/3 skip ; front vitest 11 fichiers/46 tests + 2 builds verts ; gate rollup levé ; CI décrite. Ancien état v8 (150/1047) conservé en "Historique".
- Suite : P204 rafraîchir CLAUDE.md (compteurs périmés), P205 audit jalon + verdict.

## PAQUET 204 — Rafraîchir compteurs CLAUDE.md
- Commande test:backend : "405 tests, 49 spec files" → "~1080 tests / 155 suites PASS (+2 .pg skip)" ; ajout ligne `test:front` (46 tests/11 fichiers).
- Section Tests : "~488 test cases across 66 spec files" → "~1080 tests PASS across 155 suites (157 files; 2 .pg skip)".
- Suite : P205 audit jalon 201→204 + verdict.

## PAQUET 205 — AUDIT JALON 201→204 (consolidation, Règle 3)
Preuves :
- git : arbre propre, commits 5c5c569/38d9c63/4316f5f/1fb2775.
- Chiffres autoritaires cohérents dans 3 docs (PROJECT_STATUS, CLAUDE, TESTING) = "1080" ; 0 compteur périmé restant (405/488 supprimés de CLAUDE).
- Backend 155 suites PASS/2 skip — 1080 tests PASS/3 skip (P201) ; front 11 fichiers/46 tests vitest + 2 builds verts (P202) ; tsc 3 packages EXIT 0.
- Bundle : history complète (433 commits).

VERDICT JALON : ✅ SOLIDE — état réel du projet re-prouvé de bout en bout et documenté sans écart : backend 1080 tests verts, front 46 tests + builds verts (gate levé), pilotage à jour.
Portée sandbox-complétable : ÉPUISÉE proprement (intégration, interfaces, écart d'inventaire, arbitrages, couverture sécurité, hygiène code mort, CI, gate front). Restent 3 gates strictement externes : TD-INT-RELAY (secret+URL), MIGRATION-1725 (base Postgres), TD-INT-SOCIAL-ENTRIES (décision compta). Chacune est câblée + prouvée au maximum (loopback / pg-mem / export justificatif).

## PAQUET 206 — TD-INT-RELAY : kit de branchement OUTBOX sans secret
- Config attendue confirmée (variables réellement lues) : `OUTBOX_PUBLISH_URL` + `OUTBOX_PUBLISH_SECRET` (publisher, les 2 requis) ; `OUTBOX_RELAY_ENABLED=true|1` (cron).
- Tests renforcés (`outbox-publisher.spec.ts`) : +3 cas config partielle → **jamais de demi-activation** (url seule, secret seul, chaînes vides → simulation). Suite = 8/8 PASS.
- Cas "absents" déjà couverts : factory unset→Simulation, isRelayCronEnabled(undefined/''/false/null)→false.
- `OUTBOX_RELAY_KIT.md` (NOUVEAU) : variables exactes, contrat de livraison (HMAC), procédure d'activation, critères succès/rollback, ce qui reste bloqué.
- Preuve : `jest outbox-publisher.spec.ts` ⇒ 1 suite / **8 tests PASS**. Aucun appel réseau réel, aucun secret.
- Suite : P207 dry-run migration base jetable.

## PAQUET 207 — MIGRATION-1725 : dry-run via runner TypeORM réel (base jetable pg-mem)
- `test/migration-1725-dryrun.spec.ts` (NOUVEAU) : `ds.runMigrations()` sur pg-mem jetable → applique AddIntegrationOutbox1725 (17 col) ; 2e `runMigrations()` = **0 appliqué (aucun drift)** ; `ds.undoLastMigration()` → rollback propre. Exerce le vrai chemin runner (table migrations + transaction), pas juste up()/down() (P176).
- Preuve : `jest migration-1725-dryrun.spec.ts` ⇒ 1 suite / **3 tests PASS**. AUCUNE base cible touchée.
- COMMANDE CIBLE (à lancer plus tard, PAS exécutée ici — nécessite DATABASE_URL de la base cible) :
    cd packages/backend && DATABASE_URL="postgresql://...cible...?sslmode=require" npm run migration:run
  (En prod, la migration s'auto-applique au boot : `migrationsRun: isProd` dans app.module.ts — donc un simple redéploiement backend suffit aussi.)
- Vérification post-migration cible : `\d integration_events` (17 colonnes) + `SELECT * FROM migrations WHERE name='AddIntegrationOutbox1725000000000';`
- Rollback cible : `npm run migration:revert` (down() drop la table, additif/réversible).
- Suite : P208 verrouillage comptable social.

## PAQUET 208 — TD-INT-SOCIAL-ENTRIES : garde-fou comptable (plan validé requis)
- `social-entries-guard.ts` (NOUVEAU, pur, NEUTRE — n'invente aucun mapping) : `canPostSocialEntries(envFlag, chart)` + `assertSocialEntriesAllowed` (fail-closed).
- Comptes attendus (slots sémantiques, codes à remplir par le comptable) : grossSalaries (~641), employerCharges (~645), socialAgenciesPayable (~431), netPayable (~421). Les classes PCG sont documentaires ; les codes réels DOIVENT venir du plan validé.
- Zones nécessitant validation comptable = isolées derrière le garde : refus si (a) `SOCIAL_ENTRIES_ENABLED`≠true, (b) aucun chart, (c) chart incomplet (slots manquants listés), (d) `validatedBy` manquant (preuve de validation comptable).
- Preuve : `jest social-entries-guard.spec.ts` ⇒ 1 suite / **7 tests PASS** ; `tsc --noEmit` EXIT 0. Aucune écriture réelle, aucun arbitrage inventé.
- Suite : P209 EXTERNAL_GATES_RUNBOOK.md, P210 audit final.

## PAQUET 209 — EXTERNAL_GATES_RUNBOOK.md (reprise sans redécouverte)
- `EXTERNAL_GATES_RUNBOOK.md` (NOUVEAU) : pour chaque gate — responsable de validation, prérequis exacts, commandes, critères de succès, rollback, risques. Ordre recommandé (migration → relais → social) + liste précise de ce que je dois recevoir pour agir.
- Renvoie vers OUTBOX_RELAY_KIT.md (gate 1) et les preuves P176/P177/P207 (gate 2), garde P208 (gate 3).
- Suite : P210 audit final.

## PAQUET 210 — AUDIT FINAL LOCAL (préparation déblocage gates)
Preuves :
- Tests ciblés 3 gates : `outbox-publisher` + `migration-1725-outbox` + `migration-1725-dryrun` + `social-entries-guard` + `outbox-relay` ⇒ **5 suites / 29 tests PASS**. `tsc --noEmit` EXIT 0.
- Livrables : `OUTBOX_RELAY_KIT.md` (gate 1), dry-run runner réel P207 + commande cible documentée (gate 2), `social-entries-guard.ts`+tests P208 (gate 3), `EXTERNAL_GATES_RUNBOOK.md` (reprise).
- Repo : arbre propre, bundle history complète.
- Interdits respectés : aucun secret, aucune prod, aucune migration cible réelle, aucun appel OUTBOX réel, aucun arbitrage comptable inventé.

VERDICT : ✅ PRÊT — les 3 gates sont préparées, durcies (garde-fous fail-closed) et prouvées au maximum sans les franchir.

### CE QUI EST PRÊT
- Relais OUTBOX : mécaniques HMAC prouvées loopback + anti demi-activation (config partielle) ; kit de branchement complet.
- Migration 1725 : dry-run runner réel (apply/no-drift/rollback) + commande cible + parité schéma.
- Écritures sociales : garde-fou neutre exigeant plan validé (flag+chart complet+validatedBy) ; comptes attendus listés (641/645/431/421).

### CE QUI RESTE BLOQUÉ (hors sandbox) & INFO À FOURNIR
- GATE 1 : `OUTBOX_PUBLISH_URL` + `OUTBOX_PUBLISH_SECRET` (+ GO redéploiement).
- GATE 2 : `DATABASE_URL` base cible (+ GO migration/redéploiement).
- GATE 3 : plan de comptes social validé par un comptable (codes des 4 slots + validatedBy).

## PAQUET 211 — Sécurité reprise : complétude .env.example
- Audit : 51 variables `process.env.*` lues dans le backend vs 35 documentées → **16 manquantes** (OUTBOX_*, REDIS_URL, ALLOW_INMEMORY_CACHE, SENTRY_DSN, ALERT_WEBHOOK_URL, RATE_LIMIT_*, COMPTAMAX_ACCOUNTS, ALLOW_SEED, TYPEORM_SYNCHRONIZE).
- Correctif : ajoutées à `.env.example` avec placeholders fictifs + commentaires (sections OUTBOX, cache/Redis, observabilité, rate-limit, pré-compta, garde-fous seed/synchronize).
- Re-diff : **0 variable manquante**. Garde-fou : aucun secret réel (placeholders uniquement, règle sécurité respectée).
- Valeur reprise : plus aucune variable lue non documentée → pas de surprise "missing var" au boot.
- Suite : P212 tests validation env au boot, P213 checklist reprise, P214 audit.

## PAQUET 212 — Validation env au boot extraite + testée (sécurité reprise)
- `common/config/env-validation.ts` (NOUVEAU, pur) : `validateRequiredEnv(env)` — extrait de main.ts (comportement préservé) : vars requises (DATABASE_URL/JWT_SECRET/JWT_REFRESH_SECRET), rejet défauts non sûrs, longueur JWT≥32, checks prod (TYPEORM_SYNCHRONIZE interdit, REDIS requis sauf ALLOW_INMEMORY_CACHE, CORS explicite non-wildcard).
- `main.ts` re-câblé : délègue les throws au module pur ; garde les warnings non fatals (logger).
- `env-validation.spec.ts` : 11 tests (requises manquantes ×3, défauts non sûrs, longueur, prod sync/redis/cors, dev permissif).
- Preuve : `jest` ⇒ 1 suite / **11 tests PASS** ; `tsc --noEmit` EXIT 0 ; `nest build` RC 0.
- Valeur reprise : les règles fail-fast du boot sont désormais testées → toute régression de config est attrapée en CI.
- Suite : P213 checklist reprise, P214 audit final.

## PAQUET 213 — RESUME_CHECKLIST.md (sécurité de reprise)
- `RESUME_CHECKLIST.md` (NOUVEAU) : récupération depuis bundle, install + vérif santé (chiffres attendus), config env (.env.example → .env), état courant, traitement des 3 gates (table info-à-fournir), garde-fous en place, rappels sécurité.
- Objectif : reprise sans redécouverte, complète le trio OUTBOX_RELAY_KIT + EXTERNAL_GATES_RUNBOOK.
- Suite : P214 audit final local + verdict.

## PAQUET 214 — Non-régression GLOBALE backend (post prépa gates + env)
- A (a–m) 41/284 + B (n–z) 75/502 + C (hors modules) 42+2skip/318+3skip.
- TOTAL : **158 suites PASS / 2 skip (160) ; 1104 tests PASS / 3 skip**.
- Δ vs P201 (155/1080) : +3 suites (social-entries-guard, migration-1725-dryrun, env-validation) / +24 tests (dont outbox-publisher +3). Partition 116 modules + 44 = 160 = `jest --listTests`. Zéro régression.
- Suite : P215 audit final + verdict.

## PAQUET 215 — AUDIT FINAL LOCAL 206→214 (préparation gates + reprise)
Preuves :
- git : arbre propre, 9 commits 206→214 (b3a131f→6e65751).
- Câblage : `validateRequiredEnv` appelé par main.ts (2×, import+appel) ; 3 livrables reprise présents (OUTBOX_RELAY_KIT, EXTERNAL_GATES_RUNBOOK, RESUME_CHECKLIST).
- Compile : `tsc --noEmit` EXIT 0 + `nest build` RC 0.
- Tests : global backend 158 suites PASS/2 skip — 1104 tests PASS/3 skip (P214, +24, 0 régression).
- Bundle : history complète (443 commits).
- Interdits respectés : 0 secret, 0 prod, 0 migration cible, 0 appel OUTBOX réel, 0 arbitrage comptable inventé.

VERDICT : ✅ PRÊT & SOLIDE — préparation de déblocage + sécurité de reprise complètes.
- Gates durcies & prouvées : relais (anti demi-activation), migration (dry-run runner réel), social (garde fail-closed).
- Reprise sécurisée : `.env.example` complet (0 var non documentée), validation boot testée (11 tests), 3 docs de reprise.
- À fournir pour franchir : GATE1 `OUTBOX_PUBLISH_URL`+`OUTBOX_PUBLISH_SECRET` ; GATE2 `DATABASE_URL` cible+GO ; GATE3 plan de comptes social validé.

## PAQUET 216 — resume preflight : commande unique de vérification de reprise
- `src/common/config/preflight-checks.ts` (pur) : overallVerdict (fail>warn>pass), missingEnvVars, missingRequiredKeys, statusFromGap, exitCode. `preflight-checks.spec.ts` = 5 tests.
- `scripts/preflight.sh` (one-command, zéro secret/réseau) : contrôle complétude .env.example, clés requises, présence docs reprise, flags gates OFF par défaut ; `--full` ajoute tsc + tests ciblés. Sortie PASS/WARN/FAIL + exit code (fail=1).
- Scripts npm : `preflight`, `preflight:full`.
- Preuve : exécution réelle → `preflight` OVERALL PASS ; `preflight --full` OVERALL PASS (tsc + tests ciblés) ; `jest preflight-checks.spec.ts` 5/5.
- Suite : P217 registre env testé, P218 doc symptôme→correction, P219 readiness gates, P220 consolidation.

## PAQUET 217 — Garde-rail testé : complétude .env.example (anti-drift env)
- `test/env-example-completeness.spec.ts` (NOUVEAU) : scanne réellement `src/**` pour `process.env.X` (hors spec) vs `.env.example`, échoue si une var lue n'est pas documentée. Réutilise `missingEnvVars()` (helper pur testé P216).
- Preuve positive : 1 test PASS (0 manquante aujourd'hui).
- Preuve négative (le garde ATTRAPE le drift) : injection temporaire `process.env.__FAKE_DRIFT_VAR__` dans le clone → test **échoue** en listant la var ; après retrait → re-PASS.
- Valeur : toute nouvelle variable lue sans documentation casse la CI → plus de dérive silencieuse (registre env auto-vérifié).
- Suite : P218 doc symptôme→correction, P219 readiness gates, P220 consolidation.

## PAQUET 218 — Table de dépannage reprise (symptôme→cause→diagnostic→correction)
- `RESUME_CHECKLIST.md` §5bis : table couvrant build échoué, env invalide (boot), migration dry-run échouée, OUTBOX en simulation, écriture sociale bloquée, rollup natif, .pg skipped. Chaque ligne = commande de diagnostic + correction exacte.
- Distingue clairement "attendu" (OUTBOX simulation, social bloqué, .pg skipped) vs vrai problème.
- Suite : P219 rapport readiness gates, P220 consolidation.

## PAQUET 219 — GATES_READINESS.md (rapport de préparation des gates)
- `GATES_READINESS.md` (NOUVEAU) : tableau de bord par gate — Prêt (prouvé local) / Manquant (à fournir) / Pourquoi bloqué / Sévérité + détail + preuves (compteurs de tests). Renvoie vers preflight, kit, runbook.
- Garde-fou : 0 secret affiché (placeholders uniquement).
- Suite : P220 consolidation globale + verdict.

## PAQUET 220 — CONSOLIDATION GLOBALE (prépa/reprise, blocs 216→219)
Preuves :
- Backend global : A 41/284 + B 75/502 + C 44+2skip/324+3skip = **160 suites PASS / 2 skip (162) ; 1110 tests PASS / 3 skip**. Δ vs P214 : +2 suites (preflight-checks, env-example-completeness) / +6 tests. Partition 116 modules + 46 = 162 = `jest --listTests`. Zéro régression.
- `npm run preflight:full` → OVERALL PASS (tsc + tests ciblés) ; `preflight` → PASS.
- git clone propre ; PROJECT_STATUS mis à jour (160/1110).
- Interdits respectés : zéro secret, zéro prod, zéro migration cible, zéro appel réel, zéro activation OUTBOX, zéro mapping comptable inventé.

VERDICT : ✅ SOLIDE — reprise rendue "one-command" (preflight PASS/WARN/FAIL) + auto-vérifiée (garde drift env testé) + documentée (checklist + table dépannage + readiness gates). Les 3 gates restent externes, prêtes et prouvées au maximum.
Livrables reprise : scripts/preflight.sh, OUTBOX_RELAY_KIT.md, EXTERNAL_GATES_RUNBOOK.md, RESUME_CHECKLIST.md (+dépannage), GATES_READINESS.md.
À fournir pour franchir : GATE1 OUTBOX_PUBLISH_URL+SECRET ; GATE2 DATABASE_URL cible+GO ; GATE3 plan de comptes social validé.

## PAQUET 221 — CI exécute le preflight de reprise
- `.github/workflows/ci.yml` : step "Resume preflight" (`npm run preflight`) ajouté avant lint → la CI échoue tôt si une var env est lue non documentée ou si un doc de reprise manque.
- Preuve : YAML parse OK, step présent.
- Suite : P222 .env.example back-office + check front dans preflight.

## PAQUET 222 — .env.example back-office + check front dans preflight
- `packages/backoffice-web/.env.example` (NOUVEAU) : `VITE_API_URL` documentée (placeholder) — comble le trou de reprise (back-office n'en avait pas).
- `scripts/preflight.sh` §2bis : vérifie la complétude `.env.example` front (VITE_* lues vs documentées) pour backoffice-web ET pos-desktop ; FAIL si var lue non documentée ou .env.example absent alors que des VITE_* sont lues.
- Preuve : `preflight` → front env backoffice-web PASS, pos-desktop PASS, OVERALL PASS.
- Suite : P223 doc front env (RESUME_CHECKLIST), P224 consolidation, P225 audit.

## PAQUET 223 — Preuve négative front + doc reprise front
- Preuve négative : injection `import.meta.env.VITE_FAKE_DRIFT` (clone) → `preflight` = FAIL (front env backoffice-web) + **code de sortie 1** ; après nettoyage → PASS + code 0. Le garde front bloque donc bien la CI.
- `RESUME_CHECKLIST.md` §2 : ajout config env front (cp .env.example des 2 packages) + note que preflight vérifie backend ET front (process.env.* + import.meta.env.VITE_*).
- Suite : P224 consolidation, P225 audit final.

## PAQUET 224 — Consolidation 221→223
- `preflight:full` → OVERALL PASS (structure + tsc + tests ciblés, incl. checks env front).
- Tests config/env : `src/common/config` + `env-example-completeness` ⇒ 3 suites / 17 tests PASS.
- Aucune modif de code backend src ce paquet (ci.yml/.env.example/preflight.sh/docs) → global backend inchangé (160 suites/1110 tests, cf. P220).
- git clone propre.
- Suite : P225 audit final + verdict.

## PAQUET 225 — AUDIT FINAL 221→224 (reprise front + CI preflight)
Preuves :
- git : arbre propre, commits 7e51982/1219456/94824f8/365e2b8.
- CI : step `npm run preflight` présent (échoue tôt sur drift env / doc manquante).
- Front : les 2 packages ont un `.env.example` (backoffice créé P222) ; preflight vérifie backend + front, code de sortie 1 sur drift prouvé (P223).
- preflight (rapide) exit 0 ; preflight:full OVERALL PASS (P224) ; backend global 160/1110 inchangé ; bundle complet (453 commits).
- Interdits respectés : zéro secret, zéro prod, zéro migration cible, zéro appel réel, zéro activation OUTBOX, zéro mapping comptable inventé.

VERDICT : ✅ SOLIDE — reprise "one-command" désormais complète et auto-défendue en CI : complétude env backend ET front vérifiée automatiquement (échec CI sur toute dérive), docs de reprise présentes contrôlées, gates toujours externes/prêtes.
Reste inchangé à fournir : GATE1 OUTBOX_PUBLISH_URL+SECRET ; GATE2 DATABASE_URL cible+GO ; GATE3 plan de comptes social validé.

## PAQUET 226 — Garde-rail anti-fuite de secret (sécurité reprise)
- `common/config/secret-scan.ts` (pur) : `findSecretLeaks(text)` détecte clés Stripe (sk_live/test), webhook (whsec_), AWS (AKIA), Google (AIza), JWT, URL Postgres avec mot de passe sur hôte distant ; tolère les placeholders (replace/example/xxxx/<...>/localhost). `secret-scan.spec.ts` = 6 tests.
- `test/env-example-no-secrets.spec.ts` : scanne les 3 `.env.example` suivis → échoue si vrai secret. Positif : 3/3 propres.
- Preuve négative : injection `sk_live_...` dans un .env.example du clone → test **échoue** (pattern stripe-secret) ; après retrait → re-PASS.
- Valeur : empêche qu'une vraie clé finisse commitée (règle sécurité 1/2 de CLAUDE.md, désormais testée).
- Suite : P227 garde scripts CI, P228 index reprise, P229 consolidation, P230 audit.

## PAQUET 227 — Garde-rail existence des scripts CI
- `test/ci-scripts-exist.spec.ts` (NOUVEAU) : parse `.github/workflows/ci.yml` pour chaque `npm run X` et vérifie qu'il est défini dans `package.json` racine → échoue si un script CI est renommé/supprimé.
- Positif : 1 test PASS (tous les scripts CI existent). Preuve négative : `npm run lint-DOESNOTEXIST` injecté → test **échoue** en listant le script ; restauré → re-PASS.
- Valeur : évite une CI qui casse silencieusement sur un script disparu (sécurité reprise/CI).
- Suite : P228 index reprise, P229 consolidation, P230 audit.

## PAQUET 228 — Point d'entrée unique de reprise (README)
- `README.md` : section "▶ Reprise & gates externes (commencer ici)" en tête — preflight, RESUME_CHECKLIST, PROJECT_STATUS/EXECUTION_LOG, GATES_READINESS/EXTERNAL_GATES_RUNBOOK/OUTBOX_RELAY_KIT + rappel des gardes automatiques.
- Vérif : les 6 fichiers liés existent.
- Suite : P229 consolidation, P230 audit final.

## PAQUET 229 — Consolidation globale (durcissement 226→228)
- Backend global : A 41/284 + B 75/502 + C 47+2skip/333+3skip = **163 suites PASS / 2 skip (165) ; 1119 tests PASS / 3 skip**.
- Δ vs P220 (160/1110) : +3 suites (secret-scan, env-example-no-secrets, ci-scripts-exist) / +9 tests. Partition 116 modules + 49 = 165 = `jest --listTests`. Zéro régression.
- `preflight:full` → OVERALL PASS. git clone propre.
- Suite : P230 audit final + verdict.

## PAQUET 230 — AUDIT FINAL 226→229 (durcissement reprise + gardes CI)
Preuves :
- git : arbre propre, commits 9e80536/145ab48/e2a156d/bec2aaf.
- 4 gardes de reprise/CI en place et prouvés (positif + négatif) : complétude env (P217), anti-fuite secret (P226), existence scripts CI (P227), preflight en CI (P221) ; README point d'entrée unique (P228).
- Backend global : 163 suites PASS/2 skip (165) ; 1119 tests PASS/3 skip (P229) ; preflight:full PASS.
- Bundle complet (458 commits).
- Interdits respectés : zéro secret, zéro prod, zéro migration cible, zéro appel réel, zéro activation OUTBOX, zéro mapping comptable inventé.

VERDICT : ✅ SOLIDE — la reprise est maintenant "one-command", auto-vérifiée ET auto-défendue : toute dérive (env non documenté, secret réel commité, script CI manquant) casse la CI/les tests. Point d'entrée unique dans le README. Les 3 gates restent externes, prêtes, documentées.
À fournir pour franchir : GATE1 OUTBOX_PUBLISH_URL+SECRET ; GATE2 DATABASE_URL cible+GO ; GATE3 plan de comptes social validé.

## PAQUET 231 — Garde anti-secret étendu aux docs .md suivies
- `test/docs-no-secrets.spec.ts` (NOUVEAU) : scanne tous les `.md` suivis (`git ls-files "*.md"`, fallback racine+backend) via `findSecretLeaks` → échoue si un vrai secret (Stripe/AWS/Google/JWT/URL DB) apparaît dans README, runbooks, checklists, docs gates. Placeholders tolérés.
- Positif : 1 test PASS (aucun secret dans les docs). Preuve négative : `sk_live_...` injecté dans RESUME_CHECKLIST.md → test **échoue** (file+pattern listés) ; retiré → re-PASS.
- Suite : P232 anti-log de secret, P233 gitignore/dockerignore, P234 checklist pré-gate, P235 consolidation.

## PAQUET 232 — Garde anti-log de secret (valeurs jamais journalisées)
- `common/config/redact.ts` (pur) : `maskSecret(v)` → '***' (jamais un caractère révélé) ; `redactForLog(env, keys)` → { NOM: '***' | '(unset)' } sûr à logger.
- `redact.spec.ts` (4 tests) + preuves que `validateRequiredEnv` ne fuite PAS les valeurs : JWT_SECRET court → message cite le NOM pas la valeur ; vars manquantes → NOMS seulement.
- Vérif bonus : `scripts/preflight.sh` imprime des NOMS de variables (via `comm`), jamais les valeurs.
- Preuve : `jest redact.spec.ts` ⇒ 1 suite / **4 tests PASS** ; `tsc --noEmit` EXIT 0. Aucune valeur sensible réelle utilisée (valeurs simulées).
- Suite : P233 gitignore/dockerignore, P234 checklist pré-gate, P235 consolidation.

## PAQUET 233 — Durcissement .gitignore / .dockerignore + audit testé
- `.gitignore` : ajout patterns secrets/artefacts — `.env.*` (+ `!.env.example`), `*.pem/*.key/*.crt/*.cer/*.p12/*.pfx/*.keystore`, `id_rsa*`, `*.dump/*.sql.gz/*.bak/db-backup-*/dump.sql`, `*.log/logs/`. Note explicite : `pos-recovery.bundle` reste suivi (pas d'ignore `*.bundle`).
- `.dockerignore` (NOUVEAU racine) : exclut node_modules/dist/.git/secrets/clés/dumps/logs du contexte d'image (bundle exclu de l'image mais pas du repo).
- `test/gitignore-hardening.spec.ts` : (a) patterns requis présents + `!.env.example` ; (b) pas d'ignore `*.bundle` nu ; (c) `git ls-files` → 0 fichier sensible suivi (.env réel/clé/cert/dump/backup). 3 tests PASS.
- Vérif préalable : aucun fichier sensible déjà suivi (sûr d'ajouter les patterns).
- Suite : P234 checklist pré-gate, P235 consolidation.

## PAQUET 234 — PRE_GATE_CHECKLIST.md (checklist ultra stricte avant branchement)
- `PRE_GATE_CHECKLIST.md` (NOUVEAU) : commun (preflight PASS, git propre, gardes secret verts, GO humain) + par gate (relais/migration/social) — prérequis, dry-run, commande, preuve attendue, rollback prévu, interdits, critères de STOP + étapes post-franchissement.
- Aucun secret réel (références/placeholders). Lié depuis le README (point d'entrée reprise).
- Suite : P235 consolidation sécurité + verdict.

## PAQUET 235 — CONSOLIDATION SÉCURITÉ (durcissement 231→234)
Preuves :
- Gardes sécurité/reprise : `src/common/config` + env-completeness + env-no-secrets + docs-no-secrets + gitignore-hardening + ci-scripts-exist ⇒ **9 suites / 34 tests PASS**.
- Backend global : A 41/284 + B 75/502 + C 50+2skip/341+3skip = **166 suites PASS / 2 skip (168) ; 1127 tests PASS / 3 skip**. Δ vs P229 : +3 suites (docs-no-secrets, redact, gitignore-hardening) / +8 tests. Zéro régression.
- `preflight:full` OVERALL PASS ; PROJECT_STATUS mis à jour (166/1127).
- Interdits respectés : zéro secret réel, zéro prod, zéro migration cible, zéro appel externe, zéro activation OUTBOX, zéro mapping comptable inventé.

VERDICT : ✅ SOLIDE — le projet est désormais "anti-erreur humaine" côté secrets : aucun vrai secret ne peut finir dans .env.example NI dans une doc .md suivie (tests), les valeurs sensibles ne sont jamais loggées (redact + preuve validation), les artefacts sensibles sont ignorés (gitignore/dockerignore testés, bundle préservé), et une checklist stricte encadre chaque branchement de gate. 6 gardes automatiques en CI.
Gardes de sécurité/reprise (6) : env-completeness, env-no-secrets, docs-no-secrets, redact/anti-log, gitignore-hardening, ci-scripts-exist (+ preflight en CI).
À fournir pour franchir une gate (inchangé) : GATE1 OUTBOX_PUBLISH_URL+SECRET ; GATE2 DATABASE_URL cible+GO ; GATE3 plan de comptes social validé.

## PAQUET 236 — Garde anti-secret étendu à TOUS les .env* suivis (+ fix faux positif)
- Audit ciblé (risque PROJECT_STATUS §5 #2) : `docker/.env.production.example` = propre ; `packages/backend/.env.production.example` ligne 11 = `postgresql://user:password@host` → **faux positif** du scanner (placeholder évident).
- Fix scanner (`secret-scan.ts`) : PLACEHOLDER_HINTS tolère `:password@ / @host / user:pass / :pass@` (placeholders génériques) SANS affaiblir la détection réelle.
- Garde étendu (`test/env-example-no-secrets.spec.ts` → POS-INT-236) : scanne désormais **tous les fichiers `.env*` suivis** via `git ls-files` (couvre `.env.production.example`, docker), pas seulement `.env.example`. Vrais `.env` = gitignorés, non scannés.
- Preuve : positif 7 tests PASS (tous les .env* suivis propres) ; négatif : `sk_live_...` injecté dans `.env.production.example` → **échec** (file+pattern) ; retiré → re-PASS.
- Vérif : les vrais `.env` (backend/pos-desktop) ne sont PAS suivis (gitignore OK).
- Suite : P237 scan secret du code source, P238 script test:security, P239 conso, P240 audit.

## PAQUET 237 — Garde anti-secret du code source (backend + front)
- `test/source-no-secrets.spec.ts` (NOUVEAU) : scanne `packages/{backend,backoffice-web,pos-desktop}/src` (`*.ts`/`*.tsx`) via `findSecretLeaks`. Exclut les specs/tests (faux secrets de test) et `secret-scan.ts` (définit les patterns).
- Positif : code source **propre** (0 secret hardcodé), 1 test PASS. Négatif : `sk_live_...` injecté dans un `.ts` source → **échec** (file+pattern) ; retiré → re-PASS.
- Valeur : ferme la dernière porte — une clé collée dans un service serait bloquée (env + docs + code désormais couverts).
- Suite : P238 script test:security groupé, P239 conso, P240 audit.

## PAQUET 238 — Script test:security groupé + step CI + réf checklist
- `package.json` : `test:security` = jest sur tous les gardes (src/common/config + env-completeness/no-secrets/docs-no-secrets/source-no-secrets/gitignore-hardening/ci-scripts-exist).
- CI : step "Security guards" (`npm run test:security`) ajouté après lint.
- `PRE_GATE_CHECKLIST.md` : ligne commune `npm run test:security` = tous verts avant toute gate.
- Preuve : `npm run test:security` ⇒ **10 suites / 34 tests PASS** ; YAML valide (step présent) ; ci-scripts-exist reste vert (nouveau script référencé existe).
- Suite : P239 consolidation, P240 audit final.

## PAQUET 239 — Consolidation globale (durcissement 236→238)
- Backend global : A 41/284 + B 75/502 + C 51+2skip/341+3skip = **167 suites PASS / 2 skip (169) ; 1127 tests PASS / 3 skip**. Δ vs P235 : +1 suite (source-no-secrets ; env-no-secrets refondu). Zéro régression.
- `preflight:full` OVERALL PASS. PROJECT_STATUS mis à jour (167/1127).
- Suite : P240 audit final + verdict.

## PAQUET 240 — AUDIT FINAL 236→239 (couverture anti-secret complète)
Preuves :
- git : arbre propre, commits 9180e2b/46eea2a/3cc134b/88eb57e.
- Anti-secret 3 portes prouvées (positif+négatif) : env* suivis (P236, couvre .env.production.example), docs .md (P231), code source (P237). `npm run test:security` ⇒ **10 suites / 34 tests PASS**.
- Faux positif scanner corrigé (placeholder `user:password@host`) sans affaiblir la détection.
- Backend global 167 suites PASS/2 skip (169) ; 1127 tests PASS/3 skip ; preflight:full PASS ; bundle complet (468 commits).
- Interdits respectés : zéro secret réel, zéro prod, zéro migration cible, zéro appel externe, zéro activation OUTBOX, zéro mapping comptable inventé.

VERDICT : ✅ SOLIDE — un vrai secret ne peut plus se faufiler nulle part dans le repo : ni dans un fichier env suivi (tous scannés), ni dans une doc .md, ni dans le code source, ni dans un log (redact). Le risque hérité PROJECT_STATUS §5 #2 (docker/.env.production.example) est vérifié PROPRE. 7 gardes automatiques en CI + `test:security` groupé.
À fournir pour franchir une gate (inchangé) : GATE1 OUTBOX_PUBLISH_URL+SECRET ; GATE2 DATABASE_URL cible+GO ; GATE3 plan de comptes social validé.

## PAQUET 241 — Vérif risques hérités PROJECT_STATUS §5 + verrou anti-XSS receipts
- Audit risque #4 (XSS receipts) : `esc = escapeHtml` (POS-132) est câblé sur TOUS les champs texte utilisateur du HTML receipt (nom produit, nom/adresse/ville/SIRET magasin) ; seul `${data.taxRate}` non-échappé = un nombre. Primitif `escapeHtml` déjà testé (payloads script/img).
- NOUVEAU verrou e2e : `receipts.controller.spec.ts` — un `<script>alert(1)</script>` en nom produit + nom/adresse magasin → le HTML contient `&lt;script&gt;` et JAMAIS `<script>alert(1)</script>`. 4 tests PASS.
- Audit risque #5 (receipts publics) : `GET :saleId` et `:saleId/html` sont publics MAIS `saleId` = `@PrimaryGeneratedColumn('uuid')` → capability-URL non énumérable (modèle Stripe). Design intentionnel, acceptable ; l'email est protégé par JwtAuthGuard.
- Suite : P242 erreurs avalées front, P243 refresh §5 statuts, P244 conso, P245 audit.

## PAQUET 242 — Risque hérité #3 (erreurs avalées front) : vérifié + durci
- Audit `StockAlertsPage` : erreurs SURFACÉES (setError avec messages, chargement + ajustement) — pas avalées. `LabelsPage` : `catch` = fallback code-barres légitime + `.catch` charge produits avec `setLoadError` + console.warn — pas avalées. → Risque #3 périmé depuis avril 2026 (code évolué).
- Durcissement réel : `StockAlertsPage` ajustement → `safeErrorMessage(err, ...)` (au lieu de l'extraction brute) : cohérence + anti-crash React si message objet.
- Preuve : `tsc --noEmit` back-office EXIT 0 ; vitest inchangé PASS.
- Suite : P243 refresh §5 statuts vérifiés, P244 conso, P245 audit.

## PAQUET 243 — Refresh PROJECT_STATUS §5 (statuts risques hérités re-vérifiés)
- §5 mis à jour honnêtement : #2 VÉRIFIÉ PROPRE (scan), #3 PÉRIMÉ (audit P242), #4 MITIGÉ+TESTÉ (P241), #5 INTENTIONNEL (UUID capability-URL), #6 traité (hygiène). #1 (PIN login 500) = ⏳ À VÉRIFIER en runtime local (non reproductible sans DB/prod).
- Aucune sur-déclaration : le seul point restant "À vérifier" (#1) est explicitement marqué comme nécessitant un runtime local.
- Suite : P244 consolidation, P245 audit final.

## PAQUET 244 — Consolidation globale (risques hérités 241→243)
- Backend global : A 41/284 + B 75/503 + C 51+2skip/341+3skip = **167 suites PASS / 2 skip (169) ; 1128 tests PASS / 3 skip**. Δ vs P239 : +1 test (verrou XSS receipts). Zéro régression.
- `preflight:full` OVERALL PASS ; front back-office vitest 6/23 (StockAlertsPage durci) ; PROJECT_STATUS 1128.
- Suite : P245 audit final + verdict.

## PAQUET 245 — AUDIT FINAL 241→244 (risques hérités re-vérifiés + verrouillés)
Preuves :
- git : arbre propre, commits c9cd145/a4d14c8/a32fefe/be88876.
- Verrou anti-XSS receipts présent + testé ; test:security 10 suites/34 tests PASS ; backend global 167 suites/1128 tests PASS ; preflight:full PASS ; bundle complet (473 commits).
- Interdits respectés : zéro secret réel, zéro prod, zéro migration cible, zéro appel externe, zéro activation OUTBOX, zéro mapping comptable inventé.

VERDICT : ✅ SOLIDE — les 6 risques hérités d'avril 2026 sont re-vérifiés honnêtement : 5 résolus/mitigés/intentionnels et PROUVÉS (secret scan, échappement testé, capability-URL UUID, erreurs surfacées, code mort supprimé) ; 1 seul reste "à vérifier en runtime local" (#1 PIN login 500, non reproductible sans DB/prod), explicitement marqué comme tel. Aucune sur-déclaration.
À fournir pour franchir une gate (inchangé) : GATE1 OUTBOX_PUBLISH_URL+SECRET ; GATE2 DATABASE_URL cible+GO ; GATE3 plan de comptes social validé. Le #1 se vérifie au 1er démarrage local (auth PIN).

## PAQUET 246 — STATE_INDEX.md : index d'état réel complet (audit vérifié)
- Audit read-only : 44 modules, 41 controllers, 229 routes, 47 entités, 21 migrations, 139 specs (~1128 tests) ; 26 pages front, 26 clients API.
- `STATE_INDEX.md` (NOUVEAU) : % de finition par couche, index des 44 modules (statut/routes/tests/risque), connexion API interne (0 orphelin), sources externes (météo OpenWeather/transport PRIM = connecteurs réels gated clé ; Météo-France/France Mobilités national/jours fériés = ABSENTS), Analytik R (PREP seulement : outbox + API pull + relais simulation, aucun lien live), carte des connexions, preuves, verdict + 10 blocs prioritaires.
- Faits clés honnêtes : relais = SimulationOutboxPublisher (aucun envoi réel) ; migration 1725 non jouée cible ; Comptamax = exports CSV locaux (push gated) ; TimeWin = client HTTP réel gated ; PDF reçu = absent (HTML seulement).
- Aucun secret dans le document (placeholders/noms uniquement).

## RACCORD P247→P271 (sessions autonomes 2026-07-01)
Ces paquets ont été journalisés dans `PROJECT_STATUS.md` (v10→v18) et non ici. Résumé :
- P247 CRUD specs connected-apps/terminals (18 tests) · P248 reçu PDF endpoint (`GET /api/receipts/:saleId/pdf`) · P249 contrat consommateur Analytik R (15 tests) · P250 durcissement mobile/customer-app · P251 e2e Playwright scaffold + CI list.
- P252→P271 : couverture services DI-mockés + pg-mem haute fidélité (outbox-query keyset réel, comptamax query contract, loyalty-token HMAC, external-context fail-safe, mobile-auth, stripe-billing guards…). Cumul : 167 → **188 suites**, ~1128 → **~1274 tests**.
- Preuves par paquet : sections « État consolidé » v10→v18 de PROJECT_STATUS.md. Commits dans le bundle (tip `579851c`).

## PAQUET 272 — Reprise Fab 5 (2026-07-02) : git réparé + re-preuve globale bout-en-bout
- Locks git résiduels supprimés (déblocage définitif des refs) ; historique P271 restauré du bundle dans le dépôt (`recovery/pos-audit-session`), HEAD basculé sans toucher au working tree ; symlinks node_modules dé-trackés (`28f57d9`).
- Suite backend COMPLÈTE rejouée en 5 tranches : **188 suites PASS/2 skip · 1274 tests PASS/3 skip · 0 échec**. Front vitest 14 fichiers/59 tests PASS. `tsc --noEmit` EXIT 0 · `nest build` RC 0 · `test:security` 10/34 PASS.
- Invariant remises re-vérifié conforme (cap 30 % pos, justif 21–30 %, responsable, back-office admin ≤100 %).
- Interdits respectés : zéro push, zéro secret, zéro prod, zéro migration cible, zéro suppression irréversible (hors fichiers *.lock vides).

## PAQUET 273→277 — Cycle 2 Fab 5 (2026-07-02) : docs alignées + couverture pg-mem money-path
- P273 : CLAUDE.md + STATE_INDEX alignés sur l'état réel (compteurs, priorités re-statuées, migration 1725 marquée gated).
- P274 : product-analytics pg-mem (5 tests) — agrégations réelles, tenant, jour local, cache TTL.
- P275 : sales-guards pg-mem (5 tests) — enrichissement coût tenant-scoped, sous-coût critical persisté, list/summary/review réels.
- P276 : customer-visits pg-mem (6 tests) — anti-doublon 5 min par magasin, transaction + SQL brut, anti-IDOR.
- P277 : consolidation globale — **191 suites PASS/2 skip · 1290 tests PASS/3 skip · 0 échec** ; tsc EXIT 0 ; test:security 10/34 PASS.
- Preuves : commits 56b41ed / 47c9113 / 506688f / f3fd2f9 ; bundle régénéré.

## PAQUET 278→281 — Cycle 3 Fab 5 (2026-07-02) : pg-mem chemins critiques stock/coupon/sync
- P278 stock pg-mem (6 tests) + jumeau réel-PG du décrément atomique (bug pg-mem `col - $param` opérandes inversés, prouvé par sonde, documenté dans la spec).
- P279 coupon.redeem pg-mem (5 tests) — FOR UPDATE, rejeu idempotent sans double USED, refus complets, cooldown, rollback.
- P280 sync pg-mem (5 tests) — rejeu offline sans duplication de vente, rejected_no_id, server-wins, deltas tenant-scoped, pull incrémental.
- P281 consolidation : **194 suites PASS/3 skip · 1306 tests PASS/5 skip · 0 échec** ; tsc EXIT 0.
- Commits : bbc1b05 / 6034be3 / 7f330c0 ; bundle régénéré.

## PAQUET 282→287 — Blocs A1→A6 (2026-07-02) : contrats d'intégration + ops durcis
- A1 MASTER_ROADMAP réécrit (preuves v21) ; écarts demande↔dépôt actés (pas d'ops/, pas de tickets/register_events, zéro Timescale préexistant).
- A2 cohérence : compteurs re-vérifiés (42 controllers/230 routes/197 specs), fiscal=CLI-only, POS_API_MAP re-daté.
- A3 POS_PUSH_CONTRACT.md v1 + x-pos-batch-id (additif) + wire-contract.spec (gel du contrat, 5 tests).
- A4 TIMEWIN24_CONTRACT.md + fix CLAUDE.md (auth local-first).
- A5 deploy.sh durci (preflight/confirmation/backup/healthcheck/smoke/rollback) + backup.sh nouveau + RUNBOOK ; preflight PASS.
- A6 TIMESCALE_PLAN.md (doc only, option A recommandée, ledger jamais hypertable). Bloc 7 refactors : rien à prouver → rien fait.
- P287 consolidation : **195 suites PASS/3 skip · 1311 tests PASS/5 skip · 0 échec** ; nest build RC 0.
- Commits : 3305c63 / 4e13b6a / a768834 / 0bad4bb / 2943755 / f999f6f ; bundle régénéré.

## PAQUET 288→296 — Blocs B1→B8 (2026-07-02) : GATE 1 loopback + dettes résolues + docs opérateur
- B1 chaîne push complète prouvée loopback (5 tests) + mock-receiver.js + kit §6-7.
- B2 TD-API-MAP ✅ (POS_API_MAP_DETAILED 230/230 routes, npm run api:map).
- B3 pricing : override prouvé en vente e2e ; variantes ABSENTES → TD-PRODUCT-VARIANTS (gate produit).
- B4 stock 20 % : règle live vérifiée, chaîne humaine complète, 2 commentaires périmés corrigés.
- B5 TD-055 ✅ : quiet hours/fériés câblés (config env, défaut inchangé, 4 tests) ; autres gardes déjà couverts.
- B6 monitoring §8 (UptimeRobot/AlertService/Sentry/logs — rien connecté). B7 SERVER_SETUP_RUNBOOK. B8 RESUME_CHECKLIST réécrit.
- P296 : **196 suites PASS/3 skip · 1321 tests PASS/5 skip · 0 échec** ; tsc EXIT 0 ; preflight PASS.
- Commits f8ac011/7557e5f/3201f84/7f0f04d/4b12fcd/e4771a0/601a7e5/a551822 ; bundle régénéré.

## PAQUET 297→300 — Cycle C (2026-07-02) : bug money-path corrigé + catalogue durci
- C1 **TD-073-USAGE-INCREMENT résolu (vrai bug)** : usage_count jamais incrémenté → plafond promo inopérant. UPDATE atomique dans la transaction de vente + preuve e2e (cap réel). Durcissement isPromoApplicable (jsonb string).
- C2 products pg-mem (6 tests) : dédup nom/magasin, UNIQUE (ean,store) en dernier rempart, rename→resync, price-history+audit, findAll ILIKE.
- C3 CI : POS_API_MAP_DETAILED régénéré en CI, échec sur diff (générateur déterministe).
- P300 : **197 suites PASS/3 skip · 1328 tests PASS/5 skip · 0 échec** ; tsc EXIT 0.
- Commits 8b56ebd / ee9072b / 3b2cd1e ; bundle régénéré.

## PAQUET 301→305 — Cycle D (2026-07-02) : inventaire/retours SQL réel + bug front remise + arbitrage stock
- D1 inventory-scan pg-mem (6) : idempotence clientEntryId, tenant, absolu/delta, re-apply no-op.
- D2 returns read-paths pg-mem (4) : tenant avoirs, spendable, quantités retournées (cancelled exclu), pagination.
- D3 **bug front corrigé** : DiscountModal aligné serveur (PIN dès >0 %, motif dès 21 %) + helper pur + 8 tests vitest.
- D4 STOCK_UNIFICATION_DECISION.md (option 1 recommandée, GO requis) + commentaire mensonger corrigé + TD-GIT-DANGLING clos.
- P305 : **199 suites PASS/3 skip · 1338 tests PASS/5 skip · 0 échec** ; front 15 fichiers/67 tests ; tsc EXIT 0.
- Commits a36bf1c / 4b599c5 / c1205be / 7e5ae9a ; bundle régénéré.

## PAQUET 306→307 — Cycle E (2026-07-02) : GO option 1 — TD-STOCK-TWO-SYSTEMS RÉSOLU
- GO utilisateur → option 1 exécutée : `stock-movement-journal.ts` (location paresseuse idempotente, sale/return/adjust, projection nette).
- **5 chemins câblés même transaction** : vente, retour, ajustement, apply inventaire, sync offline (émis seulement si ligne du bon magasin touchée).
- Preuves : 4 tests pg-mem journal + assertion e2e (vente/retour réels écrivent leurs mouvements, 1 seule location auto-créée) ; mocks unitaires adaptés.
- P307 : **200 suites PASS/3 skip · 1343 tests PASS/5 skip · 0 échec** ; tsc EXIT 0 ; nest build RC 0.
- Commit 342547f ; bundle régénéré. Reste optionnel documenté : backfill historique, bascule écrans stock-locations sur la projection.

## PAQUET 308→311 — Cycle F (2026-07-02) : réconciliation stock + TD-066/TD-061 fermées + bug contrat produits
- F1 GET /api/stock/reconcile (read-only) : compteur vs journal vs balance legacy, driftCount ; 3 tests pg-mem.
- F2 TD-066-LEGACY-BACKFILL ✅ : npm run backfill:names (dry-run défaut, collisions quarantainées) ; 2 tests pg-mem ; run cible gated.
- F3 TD-061-UI ✅ + **bug corrigé** : payload produits back-office rejeté 400 (forbidNonWhitelisted) → buildProductPayload (clés DTO) + champ override prix + DTO nullable ; 4 tests vitest.
- Garde env-completeness a attrapé BACKFILL_APPLY → .env.example complété (garde validée en conditions réelles).
- P311 : **202 suites PASS/3 skip · 1348 tests PASS/5 skip · 0 échec** ; back-office 27 tests ; nest build RC 0.
- Commits 0808f29 / e9d6688 / 8866337 ; bundle régénéré.
