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
