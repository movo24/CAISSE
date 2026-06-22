# MASTER_ROADMAP.md — CAISSE / The Wesley

> **Source de vérité du chantier modulaire.** Reconstruit le 2026-06-21 à partir d'un
> audit parallèle (10 auditeurs) du repo réel + vérification centrale (tsc/tests par package).
> Supersède le plan daté `MASTER-PLAN.md` (2026-03-28). Détail comportemental par module : `MODULE_SPECS.md`.
> État live + worklist P0/P1 : `PROJECT_STATUS.md`. Dette : `TECHNICAL_DEBT.md`. Journal : `EXECUTION_LOG.md`.
> Conventions + architecture-of-record : `CLAUDE.md`.

## Statuts & priorités
`✅ Fait` · `🔄 En cours` · `⬜ À faire` · `⚠️ À vérifier` · `⛔ Bloqué réel`
`P0` prod cassée/sécurité/perte données/argent · `P1` bug important/permissions/intégrité/paiement/auth · `P2` feature/UX/BO/métier · `P3` nettoyage/doc/refactor

## Vérification centrale (2026-06-21)
| Package | tsc | tests |
|---|---|---|
| backend | ✅ | jest 543 ✅ (81 fichiers, +gated pg skipped) |
| backoffice-web | ✅ | vitest 12 ✅ (3 fichiers) |
| pos-desktop | ✅ | vitest 75 ✅ (11 fichiers) |
| mobile | ✅ (réparé M703) | vitest 5 ✅ (1 fichier) |
| customer-app | ⛔ dep manquante (M704) | 0 test |

## Items PARQUÉS (STOP — ne pas construire)
NF525 certification / Z-seal signature fiscale · Comptamax export/mapping comptable (expert-comptable) · porte offline-sale (acceptation hors-ligne) · onboarding/pricing SaaS.

---

## Domaine A — Ventes / Fiscal / Paiements  (M001–M013)

### M001 — Sales : createSale core + chaîne de hachage fiscale
- **Statut** ✅ · **Priorité** P1 · **Dépendances** products, stock, promotions, audit
- **Objectif** Vente atomique, hachée (chaîne par magasin), TVA extraite TTC, idempotente.
- **Scope** items→lignes, remises (ligne/auto/manuelle/promo), paiements multi-tender, stock décrémenté en tx, hash chaîné.
- **Fichiers** `modules/sales/sales.service.ts`, `entities/sale*.entity.ts`
- **Tests** `sales.service.*.spec.ts`, `test/e2e-money-flow.spec.ts` · **Validation** suite verte + hash vérifiable.

### M002 — Sales : capture paiement (decision 6 — payment_pending)
- **Statut** ✅ · **P1** · Aucun ticket "paid" sans capture réelle ; legs non capturés → `payment_pending` + alerte + audit.
- **Fichiers** `sales.service.ts`, `entities/sale-payment.entity.ts`, mig 1743 · **Tests** `test/payment-pending-capture.spec.ts`.

### M003 — Sales : enforcement remise manuelle (decision 5)
- **Statut** ✅ · **P2** · Cap dur 30 %, approbateur manager obligatoire, distribution proportionnelle, audit approbateur. **Fichiers** `sales.service.ts`, mig 1742.

### M004 — Sales : idempotence (NF525 rejouabilité)
- **Statut** ✅ · **P1** · Clé idempotence transactionnelle, replay = même réponse. **Tests** `sales.service.idempotency.spec.ts`.

### M005 — Sales : tender `store_credit` accessible via HTTP
- **Statut** ✅ · **P1** · `store_credit` whitelisté + `creditNoteCode` ajouté au DTO + spec contrat (commit b9fdebe).

### M006 — Fiscal : vérificateur de chaîne + journal
- **Statut** ✅ · **P1** · `FiscalVerifyService` fait un recompute **AUTORITATIF** de `fiscal_journal` (payload verbatim) + linkage (fork/orphan/unreachable/genesis) ; spec `test/fiscal-verify.spec.ts` (clean/tamper/linkage). Différé : index anti-fork fiscal_journal (toucherait la tx de void sans retry) ; recompute autoritatif sales/credit_notes = NF525 PARQUÉ.
- **Fichiers** `modules/fiscal/fiscal-verify.service.ts`, `entities/fiscal-journal.entity.ts` (mig 1717).

### M007 — Returns : avoirs + cartes cadeaux (hachés)
- **Statut** ✅ · **P1** · Avoirs hash-chaînés, reprint audité. **Tests** `avoir-m1-m3.spec.ts`, `credit-note-receipt.spec.ts`. **Dette** D1 (retour cash fiscal).

### M008 — Sales-guards (moteur d'anomalies)
- **Statut** ✅ · **P2** · Garde-fous ventes. **Tests** `sales-guards*.spec.ts`.

### M009 — Stripe Terminal (PSP)
- **Statut** ✅ · **P1** · Intégration lecteur, secrets via env. **Note** validation runtime nécessite env Stripe (⛔ test live).

### M010 — POS Session (sessions liées terminal)
- **Statut** ✅ · **P2** · Ouverture/fermeture session, X-report. **Frontière** issue sale↔session signalée.

### M011 — POS Integration / loyalty (coupon redeem)  ✅ P2
### M012 — Terminals (registre TPE)  ✅ P2
### M013 — Receipts (ticket digital + reprint)  ✅ P2 · reprint audité.

---

## Domaine B — Catalogue / Stock / Inventaire  (M101–M112)

### M101 — Products : catalogue core  ✅ P2 · price history, prix effectif, génération code-barres.
### M102 — Variants / SKU (decision 5)  ✅ P2 · variante = ligne produit (parent), chemin vente inchangé. mig 1740.
### M103 — Prix par magasin (decision 4)  ✅ P2 · override effectif avant pricing. mig 1739.
### M104 — Marques / Fournisseurs (decision 3)  ✅ P2 · mig 1738, CSV résout par nom.
### M105 — CSV import/export (Bloc 4i)
- **Statut** ✅ · **P2** · round-trip + brand/supplier testés (`test/products-csv.spec.ts`) ; **garde anti formula-injection** (CWE-1236) ajoutée dans `toCsv` (commit d8ea297).
### M106 — Stock : décrément/ajust mono-table (race-safe)  ✅ P1 · `GREATEST(0, …)` en tx.
### M107 — Stock multi-emplacements (stock-locations)
- **Statut** 🔄 · **P1** · Double source de vérité (D11). **Diagnostic read-only livré** : `findStockDivergences` + `GET /stock-locations/divergences` (commit 0123cca). Reste : décision A/B/C + réconciliation one-shot (écrit stock réel = prod-gated) ; `CHECK(quantity>=0)`. mig 1735.
### M108 — Réconciliation stock / écart ≥20 % (decision 7)
- **Statut** ✅ · **P1** · Logique + spec (existait + ajout boundary 19/20/21 % & reject, commit df08a09). mig 1737.
### M109 — Inventory scan  ✅ P2 · capture code-barres idempotente.
### M110 — Promo codes (decision 6)  ✅ P1 · validate/redeem/reserveAtSale (cap race-safe, applied-at-sale). mig 1741. **Tests** `promo-codes.spec.ts` (+gated pg).
### M111 — Promotions (règles auto panier)  ✅ P2 · percentage/fixed/buy_x/first_purchase.
### M112 — Currency / FX  ⚠️ P3 · conversion multi-devise à vérifier.

---

## Domaine C — Identité / Org / RH  (M201–M210)

### M201 — Auth (JWT employé / PIN / rotation)  ✅ P1
### M202 — RBAC (RolesGuard + matrice)  ✅ P1
### M203 — Isolation tenant (TenantInterceptor)
- **Statut** ✅ · **P1** · `@Roles('admin')` sur GET org/units/stores (commit a128bfd) ; non-admins → `/stores/me|accessible`. (scoping org par token = P2.)
### M204 — Employees (CRUD / PIN)  ✅ P1
### M205 — TimeWin event idempotency (decision 1)  ✅ P1 · outbox UNIQUE idempotency_key. mig 1736.
### M206 — TimeWin proxy + résilience  ✅ P2
### M207 — Stores (CRUD / lifecycle / schedule)
- **Statut** ⚠️/⛔ · **P1** · `hardDelete` : **~20 tables `store_id` non purgées dont fiscal** (D18) → orphelins ; modifier = destructif+fiscal+rétention légale = **décision owner/comptable**. `syncFromTimeWin` sans garde anti-désactivation massive (à câbler).
### M208 — Organizations & Units
- **Statut** ✅ · **P1** · `@Roles('admin')` sur GET org/units (commit a128bfd). Reste P2 : reactivate documenté.
### M209 — Mobile-auth (identité client)  ✅ P2
### M210 — Shift reminders  ✅ P3

---

## Domaine D — Client / Fidélité / Engagement  (M301–M310)

### M301 — Customers (inscription, OTP, QR, points)
- **Statut** ✅ · **P1** · `otpCode` retiré de la réponse (commit a128bfd). Reste P2 : OTP en Redis (multi-instance).
### M302 — Customer PII / RGPD effacement
- **Statut** ✅ · **P1** · `anonymize(id)` scrub PII en place + soft-delete + endpoint admin audité (commit 1e07f51) ; zéro enregistrement fiscal touché. Reste P2 : export portabilité ; carve-out factures (rétention 10 ans à confirmer comptable).
### M303 — Loyalty card + QR HMAC  ✅ P2 · HMAC-SHA256 + TTL 60s + compare constant-time + rotation ; spec sécurité ajoutée (commit 487ceb1).
### M304 — Customer visits (anti-doublon scan)  ⚠️ P2
### M305 — Loyalty admin (cycles, coupons, analytics)  ⚠️ P2
### M306 — Jackpot (Smart-Foule)  ✅ P2 · vérifié read-only (D14) : roll serveur fail-closed + quotas/proba + config admin → faux positif.
### M307 — Occupancy (radar live-count)  ⚠️ P2
### M308 — Notifications (rappels + alertes, read-only)  ⚠️ P2
### M309 — Documents (PDF duplicata/avoir/Z)  ✅ P3
### M310 — Subscriptions / SaaS billing  ⛔ P3 · **domaine PARQUÉ**.

---

## Domaine E — Plateforme / Intégration  (M401–M407)

### M401 — Reports : X-report + Z-report  ✅ P2 · **Note** Z vs KPI utilisent des colonnes date différentes (created_at vs completedAt) — divergence possible à minuit.
### M402 — Audit / hash-chain
- **Statut** 🔄 (détection ✅ / couplage write = lot ouvert) · **P1** · (commit 4355922, GO owner) DÉTECTION durcie : v1 hachait `details` comme `{}` (bug replacer) ⇒ tamper indétectable ; fix `computeAuditHashV2` (canonicalisation récursive) + `hashed_at` persisté + recompute v2 (v1 = linkage-only) + index unique anti-fork (genesis = sentinel `0×64`, pas NULL → mono-genesis garanti) + retry doLog + migration 1744 (pré-check fork). Spec `test/audit-chain-verify.spec.ts`.
- **Reste (D16/D17)** : couplage « op⟺audit » NON garanti (audit out-of-band best-effort post-commit, pré-existant) → décision archi owner (in-tx fail-closed vs alerte-sur-drop) ; frontière v1 non-vérifiable + périmètre NF525 à trancher.
- **Fichiers** `modules/audit/audit.service.ts`, `entities/audit-entry.entity.ts`, mig 1744.
### M403 — Sync : file offline push-pull
- **Statut** ✅(base)/⚠️(authz) · **P1** · `POST /sync/push` fait confiance à `payload.storeId` sans le confronter à `req.user` ⇒ un device peut écrire dans un autre magasin (pull/status corrects). **Action** scoper storeId à req.user. **Note** porte offline-sale PARQUÉE (distincte).
### M404 — Health checks  ✅ P2 · (commentaire "2s" vs timeout 5s — nit).
### M405 — Airtable-ops (intégration HITL)  ✅ P2 · gold-standard (env, HMAC, rate-limit). nit: timingSafeEqual length-mismatch → 500 au lieu de 401.
### M406 — Connected-apps (registre tiers)
- **Statut** 🔄 · **P1 SÉCU** · `GET` renvoie `api_key` en clair **et** pas de scoping org ⇒ un caissier lit les credentials tiers de **n'importe quelle** org.
- **Action** `@Exclude`/DTO sans api_key + `@Roles` + scoping org ; à terme colonne chiffrée.
### M407 — Sales-AI (recommandations + enrichissement)  ✅ P3 · enrichissement fail-safe ; clé OpenWeather en query (peut fuiter aux logs — nit).

---

## Domaine F — Front BackOffice (backoffice-web)  (M501–M509)

### M501 — Routing & shell (main.tsx / Layout / ProtectedRoute / ErrorBoundary)  ✅ P2
### M502 — API client (services/api.ts)  ✅ P2
### M503 — Pages features decisions 1-8 (variants, store-prices, brands/suppliers, promo-codes, pending-payments, inventory-variance)  ✅ P2
### M504 — UI remise manuelle cap+approbateur  ⚠️ P2 · vérifier surface BO (l'enforcement est serveur).
### M505 — ReportsPage onglet "Analytique avancée" placeholder  🔄 P2
### M506 — Page TimeWin24 = ComingSoonPage  ⬜ P3 · stub délibéré.
### M507 — Couverture tests (vitest, 3 fichiers)  🔄 P2 · étendre.
### M508 — Écrans BO manquants pour features backend existantes  ⬜ P2 · cartographier le delta.
### M509 — BillingPage (Stripe subscriptions)  ⚠️ P1 · runtime non vérifiable sans env Stripe (lié domaine parqué).

---

## Domaine G — Front POS (pos-desktop)  (M601–M610)

### M601 — Complétion paiement carte/TPE
- **Statut** 🔄 · **P1** · Branche succès du TPE **non câblée** (pas de trigger appelant `handleTpeResponse('success')`).
- **Action** câbler `useStripeTerminal.collectPayment` OU bouton caissier "Paiement validé/refusé" ; trancher modèle TPE (autonome vs Stripe reader) ; test branche succès.
### M602 — Machine à états tender (pure)  ✅ P2 · testée.
### M603 — Paiement scindé/mixte + finalize
- **Statut** ⚠️ · **P1** · `creditNoteCode` non inclus dans l'enqueue offline ⇒ redemptions store_credit perdues hors-ligne ; logique paiement dupliquée POSPage vs usePayment.
- **Action** inclure creditNoteCode offline ; tests finalize (online/offline/4xx).
### M604 — Contrôle remise manuelle (miroir decision 5)  ✅ P2
### M605 — Contrôle code promo (decision 6)  ✅ P2
### M606 — File offline + persistance + garde-fraude  ✅ P2
### M607 — Sync engine (FIFO + HMAC + idempotence)
- **Statut** ⚠️ · **P1** · Vérifier que les **headers HMAC sont réellement transmis** (pas juste loggés) ; conflict-detection no-op à documenter/implémenter.
### M608 — Peripheral bridge (imprimante/scanner/tiroir)  ⚠️ P2
### M609 — Overlay reçu/confirmation + choix ticket  ✅ P2
### M610 — Porte offline-sale  ⛔ P2 · **PARQUÉ**.

---

## Domaine H — Apps Mobile / Client  (M701–M706)

### M701 — mobile : file offline inventaire + sync  ✅ P2
### M702 — mobile : UI scan/inventaire/réception/recherche/création produit  ⚠️ P2
### M703 — mobile : build tsc (vite-env)  ✅ P1 · **RÉPARÉ** (commit 6ce722c : `src/vite-env.d.ts`). tsc ✅ + vitest 5 ✅.
### M704 — customer-app : build tsc (@capacitor/preferences)
- **Statut** ⛔→🔄 · **P1** · dep déclarée (^6) mais non installée. **Action** `npm install` racine pour `@capacitor/{preferences,app,push-notifications}@^6` (réseau OK) puis tsc ; OU retirer push-notifications (non importé).
### M705 — mobile : PWA web, pas natif Capacitor/iOS  ⚠️ P2 · décision archi (RN/Swift/PWA) — cf MASTER-PLAN.
### M706 — customer-app : complétude features fidélité (post-fix)  ⚠️ P2

---

## Domaine I — Transverse  (M801–M804)

### M801 — Intégrité migrations  ✅ P2 · 24 migrations monotones, additives, zéro drift vs entities. (gap 1719→1735 intentionnel non commenté.)
### M802 — Hygiène secrets / env
- **Statut** ⚠️ · **P0(doc)** · `src` propre (env-only) MAIS **token Railway en clair** `MONITORING-PLAYBOOK.md:168` + clés fuitées en historique git (AUDIT-FINAL S1). seeds PIN 1234/5678 littéraux.
- **Action** rédiger le token (fait M-EXEC), rotation = ⛔ owner ; seeds → env.
### M803 — Conventions (CLAUDE.md)  🔄 P3 · counts stale (37 modules/45 entities/405 tests/mig 1715 vs 42/53/543/1743) ; promo-codes & stock-reconciliation non documentés ; barrel entities/index.ts omet 11 entités récentes (inoffensif).
### M804 — Dead-code / docs dupliquées  ⚠️ P3 · cf harmonisation docs (ce fichier + PROJECT_STATUS + TECHNICAL_DEBT).

---

## Domaine J — Documentation & Process  (M901)
### M901 — Harmonisation docs  🔄 P2
- `MASTER_ROADMAP.md` (ce fichier, canonique) supersède `MASTER-PLAN.md` ; `TECHNICAL_DEBT.md` supersède/absorbe `DEBT.md` ; `CLAUDE.md` reste architecture-of-record (à rafraîchir M803) ; `AUDIT-COMPLET.md`/`AUDIT-FINAL-2026-04-01.md`/`INCIDENT-REPORT-*`/`TEST-MATRIX.md`/`DEPLOIEMENT-PLAN.md` = snapshots datés immuables, findings ouverts portés dans `TECHNICAL_DEBT.md` ; `plan.md` = spec Jackpot livrée (→ MODULE_SPECS).
