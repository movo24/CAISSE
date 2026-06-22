# TECHNICAL_DEBT.md — registre de dette nommée

> **Registre canonique** (supersède `DEBT.md`). Append-only. Une dette = un manque conscient,
> scopé — ni bug silencieux ni TODO perdu. Chaque entrée nomme *ce qui n'est pas couvert*,
> *pourquoi c'est différé*, *ce qui la ferme*. Fermer une dette = une PR qui retire son entrée.
> Les audits datés (`AUDIT-COMPLET.md`, `AUDIT-FINAL-2026-04-01.md`, `INCIDENT-REPORT-2026-04-01.md`)
> sont des snapshots immuables ; leurs findings ouverts vivent ICI.

Statuts : OPEN · IN PROGRESS · BLOCKED (owner/accès) · CLOSED (PR retire l'entrée).

---

## D1 — Reversal fiscal d'une vente **cash** via `createReturn` non couvert
**Status:** OPEN · named debt · fiscal-design PR séparée. **Since:** void-cash-realized guard (#10), 2026-06-12.

**Contexte.** Le guard `void-cash-realized` (`sales.service.ts` ~L933+) refuse de `void` une vente avec leg cash réalisé ; l'annulation doit passer par le **retour** (`createReturn`, remboursement cash). Le trou de sécu (voider du cash réalisé) est **fermé**.

**Ce qui n'est PAS couvert (la dette).** Le comportement chaîne-fiscale / `fiscal_journal` du **chemin remboursement cash `createReturn`** n'est **pas testé** : M3/M4 ont été exercés sur `void` puis transposés vers `store_credit`/`card`. Aucun test ne prouve qu'un retour cash produit l'événement/chaîne/effet Z corrects.

**Pourquoi différé.** C'est une question de *design* fiscal (le retour cash émet-il son propre événement journal ? chaînage ? ventilation Z), pas un fix une-ligne.

**Ce qui la ferme.** PR fiscal-design : (1) spécifie la sémantique retour-cash, (2) spec `createReturn`-cash end-to-end, (3) retire cette entrée. **Cross-refs.** `CLAUDE.md` Known Issues ; `sales.service.ts` ; `void-cash-realized-guard.spec.ts`, `avoir-m1-m3.spec.ts`, `void-m4-journal-chain.spec.ts`.

---

## D2 — connected-apps expose `api_key` + pas de scoping org  (M406)
**Status:** OPEN · **P1 SÉCU.** `GET /connected-apps` (findAll/findOne) renvoie `api_key` en clair et n'est pas scopé à `req.user.organizationId` ⇒ un caissier lit les credentials tiers de n'importe quelle organisation.
**Ferme :** `@Exclude` sur la colonne (ou DTO de réponse sans `api_key`) + `@Roles` + scoping org ; à terme colonne chiffrée (pattern airtable-ops). Confirmé par be-platform + xcut.

## D3 — audit `verifyChain` ne recalcule pas le hash  (M402) — ✅ CLOSED (commit 4355922)
**Fermé** : la v1 hachait `details` comme `{}` (bug de replacer-array) ⇒ tamper indétectable, et le timestamp haché n'était pas persisté. M402 : `computeAuditHashV2` (canonicalisation récursive) + `hashed_at` persisté ⇒ `verifyChain` recompute les lignes v2 et détecte le tamper de `details` ; v1 = linkage-only (pas de faux positif) ; index unique `(store_id, previous_hash)` anti-fork + retry dans doLog ; migration 1744. Spec `test/audit-chain-verify.spec.ts`.

## D4 — fiscal `verifyChain` (fiscal_journal)  (M006) — recompute autoritatif ✅ ; anti-fork fiscal = LOT OUVERT
**Recompute `fiscal_journal` AUTORITATIF** (payload verbatim) + détection fork/linkage : déjà en place (`FiscalVerifyService`), prouvé par `test/fiscal-verify.spec.ts`. **LOT OUVERT explicite (PAS « couvert »)** — *asymétrie audit/fiscal* : l'anti-fork est par **construction** côté audit (index unique + retry) mais seulement par **détection** côté fiscal (la chaîne la plus réglementée). L'index unique `fiscal_journal (store_id, hash_chain_prev)` n'est PAS ajouté car il ferait rollback la **transaction de void** sur un fork concurrent **sans stratégie de retry** dans ce chemin → nécessite un **design concurrence du void** dédié (retry/relecture de tête dans la tx) + validation prod. **Différé, à nommer comme lot, pas comme fait.** (b) recompute autoritatif `sales`/`credit_notes` = **NF525-adjacent, PARQUÉ**.

## D5 — sync `POST /push` fait confiance à `payload.storeId`  (M403)
**Status:** OPEN · **P1 AUTHZ.** L'endpoint déjà livré ne confronte pas `payload.storeId` à `req.user` (pull/status le font via resolveStoreId) ⇒ un device peut écrire dans un autre magasin. **Ferme :** scoper/valider storeId contre l'utilisateur. (Distinct de la porte offline-sale PARQUÉE.)

## D6 — token Railway en clair dans `MONITORING-PLAYBOOK.md`  (M802)
**Status:** IN PROGRESS (repo) / BLOCKED (rotation owner). Token `TOKEN=4714644a-…` ligne 168. **Rédaction dans le fichier = faite cette campagne** (stoppe la propagation), MAIS il reste dans l'historique git et **doit être ROTÉ** côté Railway. **Ferme :** rotation du token par l'owner (accès Railway) + purge historique si jugé nécessaire.

## D7 — séparation des bases prod non confirmée  (INCIDENT 2026-04-01)
**Status:** BLOCKED/VERIFY · **P0 si non fait.** Le postmortem documente une perte de données par base partagée cross-ORM. Si la séparation n'a pas été réalisée, le risque de destruction shared-DB est **live**. **Ferme :** preuve de séparation (env/URLs distinctes) ou exécution de la séparation (action prod = owner GO).

## D8 — clés API fuitées en historique git  (AUDIT-FINAL S1)
**Status:** BLOCKED (owner). Clés réelles committées (`docker/.env.production.example` historique). **Ferme :** rotation des clés (accès secrets) + décision purge historique. Action owner.

## D9 — XSS receipts + endpoint receipts public  (AUDIT-FINAL S2/S3) — ✅ S2 remédié (vérif lecture 2026-06-22)
**S2 XSS = REMÉDIÉ + durci (commit 5309908).** `esc()` (échappe `& < > " '`) appliqué à toutes les chaînes contrôlables des DEUX builders HTML ; le résiduel `<title>` (vente) est désormais `esc(data.ticketNumber)` (le builder avoir l'échappait déjà). Numériques/dates bruts (sûrs). S2 clos.
**S3 « receipts public » = PAR DESIGN** : reçu accessible par QR via UUID opaque (inguessable) ; reprint/email sont authentifiés. Acceptable ; note : toute personne avec l'UUID lit les données du reçu (nom caissier, SIRET). Si jugé sensible → rate-limit/expiry = décision produit.

## D16 — Couplage `audit.log` ⟂ transaction métier : NON UNIFORME (M402 review) — fait établi
**Status:** OPEN · **P1.** `AuditService.log` n'accepte jamais de `queryRunner`/`EntityManager` → il écrit **toujours via sa propre connexion** ⇒ **jamais atomique** avec l'écriture métier. La **position** de l'appel varie (recensé sur les 12 appelants, ~26 sites) :
- **Classe 3 — audit dans une txn métier OUVERTE** (commit indépendant pendant que la txn tourne) ⇒ **AUDIT FANTÔME** si rollback : `stock.service.adjustStock` (audit insidé le `dataSource.transaction`, après `manager.save`), `coupon.service.redeemCoupon` (audit = dernier stmt de sa txn). `adjustStock` est appelé par `stock-reconciliation.confirmCorrection` (correction de variance, décision 7).
- **Classe 1 — post-commit best-effort** (`try/catch → warn`, +alerte D16) ⇒ op committée, audit possiblement manquant : `sales` (×7), `sync` (×1).
- **Classe 2 — aucune txn englobante** (deux commits séquentiels indépendants) : `stock.decrementStock` (×2), `stock-reconciliation` (×3), `products` (×3), `subscriptions` (×2), `auth` (×2), `promo-codes`, `pos-session`, `employees`, `receipts`.

**Sous-bug classe 3 (audit fantôme) — ✅ CLOSED (commit f2b39b9, GO encadré owner)** : `stock.adjustStock` et `coupon.redeemCoupon` émettent désormais l'audit APRÈS résolution de la transaction, en best-effort (comme classe 1) ; coupon ne ré-audite pas un replay de cache. Rien d'autre touché (montants/stock/paiement/reçus/fiscal/archi). Tests avant/après : un échec d'audit ne roll back plus l'op committée. **Reste classe 2** (commits indépendants) = acceptable pour de l'audit applicatif ; **décision archi globale** (in-tx fail-closed vs out-of-band best-effort) toujours owner, gated D17.

**Décision d'architecture plus large (owner, gated D17)** : (a) audit **dans la txn métier** (fail-closed, atomique — nécessite que `AuditService.log` accepte un `manager`) vs (b) garder out-of-band best-effort + alerte-sur-drop (déjà livré, commit 419b2fd). **Ferme :** corriger classe 3 (sur GO) + trancher (a)/(b) une fois D17 (périmètre NF525) connu.

## D17 — Frontière d'intégrité v1 de la chaîne d'audit + périmètre NF525  (M402)
**Status:** OPEN (à tracer) · Tout l'historique **v1** (`hashed_at` NULL) reste **linkage-only** : son `details` n'a jamais été couvert par le hash (bug replacer) et n'est plus recalculable ⇒ cryptographiquement non-prouvable. M402 protège le futur (v2), pas le passé. **Question owner/expert-comptable :** la chaîne `AuditService` est-elle **dans le périmètre NF525** ou un audit applicatif interne ? Si dans le périmètre, « tamper de `details` indétectable sur tout l'historique v1 » est un **écart de conformité à tracer**, pas une note. **Ferme :** décision de périmètre documentée (+ éventuel scellement/export de l'historique v1 en l'état comme borne).

## D10 — Stripe : idempotency `Date.now()`, intent non lié, conflict no-op, EUR/taxRate20 en dur  (AUDIT-COMPLET)
**Status:** VERIFY/OPEN · **P1/P2.** Findings de mars à reconfirmer contre le code actuel (capture decision 6 a déjà touché ce chemin). **Ferme :** vérifier chaque point ; idempotency déterministe ; lier `stripePaymentIntentId` ; devise/taux depuis le store.

## D11 — Double source de vérité stock (legacy column vs stock_balances)  (M107) — diagnostic ✅, décision + réconciliation gated
**Status:** IN PROGRESS · **P1.** `product.stockQuantity` (décrémenté par les ventes) et `stock_balances` (écrasé dans la colonne par `syncLegacyStock`) divergent silencieusement. **Consommateurs** (vérifié) : valorisation analytique + garde de vente ; **Z fiscal NON concerné**. **Livré (commit 0123cca)** : `findStockDivergences()` read-only + endpoint `GET /stock-locations/divergences` (admin/manager) + spec → rapport d'écart sans mutation. **Reste** : (a) **décision** source unique A/B/C (`docs/design/M107-stock-source-of-truth.md`) = archi ; (b) **réconciliation one-shot** qui ÉCRIT le stock réel = **prod-gated** (validation avant exécution) ; (c) `CHECK(quantity>=0)`.

## D12 — customers `POST` renvoie `otpCode`  (M301)
**Status:** OPEN · **P1 SÉCU.** L'OTP est renvoyé dans la réponse de création. **Ferme :** ne renvoyer que customer + qrCodeDataUrl (log dev-only). (P2 : store OTP en Redis pour multi-instance.)

## D13 — Effacement RGPD client  (M302) — ✅ CLOSED (commit 1e07f51)
**Fermé** : `CustomersService.anonymize(id)` scrub la PII EN PLACE (first/last/phone/email/password_hash + qr_code neutralisé `ANON-<id8>`), soft-delete (`deleted_at`+`anonymized_at`, colonnes déjà en mig 1712), idempotent, endpoint `POST /customers/:id/anonymize` admin-only + audité (metadata only). **Aucun enregistrement fiscal touché** (vérifié : ventes = customer_id seul). Tests : scrub+markers+conserve, idempotence, NotFound. **Reste (non bloquant)** : (P2) export de portabilité RGPD ; carve-out factures nominatives **seulement si** on génère des factures nominatives (durée 10 ans proposée, à confirmer comptable).

## D14 — Jackpot « fallback silencieux »  (AUDIT-COMPLET, M306) — ✅ VÉRIFIÉ (lecture, 2026-06-22) : faux positif
**Vérifié** : `rollLottery` est **côté serveur**, **fail-closed** (pas de config / inactif → `no_win` enregistré, jamais de grant silencieux), borné par quota jour + densité + probabilité ; la config est `@Roles('admin')`. Le « fallback » = no_win = sûr. **Résiduels faible sévérité** (jeu **marketing**, pas d'argent/fiscal) : `Math.random()` (acceptable ici ; à durcir uniquement si un gain mappe une vraie valeur monétaire) ; `GET :storeId/config` non scopé tenant (config non sensible : URLs vidéo + probabilités). **Pas un trou >60%.** Aucun changement requis ; durcissements optionnels notés.

## D18 — `stores.hardDelete` laisse des orphelins (dont fiscal) + légalité  (M207) — ⛔ décision owner/légale
**Status:** OPEN · **P1 (impact données/fiscal/légal).** Vérifié en lecture (2026-06-22) : `hardDelete` purge une liste **tenue à la main** (`tablesWithStoreId` + `core` + sale-children ≈ 16 tables) mais **~20 tables avec `store_id` ne sont PAS couvertes** → orphelins après suppression d'un magasin. Notamment des **enregistrements fiscaux** : `credit_notes`, `credit_note_redemptions`, `fiscal_journal`, `pos_sessions` ; + `customer_visits`, `brands`, `suppliers`, `promo_codes`, `promo_code_redemptions`, `stock_variances`, `store_product_prices`, `timewin_events`, `price_history`, `product_store_availability`, `payment_terminals`, `sale_anomaly_logs`, `loyalty_reward_cycles`, `stock_locations`, `ai_recommendation_logs`, `airtable_*`.
**Pourquoi je n'y touche PAS en autonomie** : (1) c'est une **opération destructive irréversible** (suppression définitive) ; (2) elle purge déjà `sales` (donnée fiscale) et devrait/ne-devrait-pas purger `credit_notes`/`fiscal_journal` → **question de rétention légale NF525** (hard-delete de pièces fiscales ?) = **décision produit/légale non tranchée**. Ajouter des `DELETE FROM` ou retirer la purge fiscale modifie un flux destructif+fiscal → stop-list.
**Ferme (owner + comptable)** : décider (a) si `hardDelete` doit exister pour un magasin à historique fiscal (vs un soft-archive/rétention), (b) la liste exacte à purger vs conserver, (c) FK `ON DELETE CASCADE` ou liste générée depuis la metadata. Ensuite : implémentation + drift-guard test (couverture = toutes les tables `store_id`).

## D15 — Dérive doc CLAUDE.md + nits  (M803)
**Status:** OPEN · **P3.** Counts stale (37/45/405/mig1715 vs 42/53/543/1743) ; promo-codes & stock-reconciliation non documentés ; barrel `entities/index.ts` omet 11 entités (inoffensif) ; seeds PIN 1234/5678 littéraux ; `migration:run` pointe un chemin typeorm/cli.js inexistant ; health "2s" vs 5s ; Z vs KPI colonnes date différentes. **Ferme :** rafraîchir CLAUDE.md + corriger les nits.
