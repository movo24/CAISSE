# EXECUTION_LOG.md — journal d'exécution (chantier modulaire)

> Append-only. Chaque entrée : date, action, modules, vérifs lancées + résultat, commit.

---

## 2026-06-21 — Reprise méthode modulaire autonome

### Audit + reconstruction
- Orientation repo + **vérification centrale** (tsc 5 packages, tests par package). Faits : backend/backoffice/pos tsc ✅ ; mobile ⛔ (vite-env) ; customer-app ⛔ (dep capacitor). Tests : backend 543, backoffice 12, pos 75.
- **Audit parallèle 10 agents** (workflow `pos-caisse-modular-audit`) → 94 modules cartographiés (48✅/27⚠️/12🔄/4⛔/3⬜), 50 actions P0/P1, registre dette.
- **Fichiers de suivi créés/harmonisés** : `MASTER_ROADMAP.md` (supersède `MASTER-PLAN.md`), `PROJECT_STATUS.md`, `MODULE_SPECS.md`, `TECHNICAL_DEBT.md` (supersède `DEBT.md`, D1 conservé + D2–D15), `EXECUTION_LOG.md`.

### M703 — mobile tsc réparé (P1)
- Ajout `packages/mobile/src/vite-env.d.ts` (vite/client + ImportMetaEnv VITE_API_URL), miroir backoffice.
- **Vérifs** : mobile tsc ✅, vitest **5/5** ✅.
- **Commit** `6ce722c`.

### Fichiers suivi + P0 (commit fee2c0e)
- 5 fichiers de suivi créés + harmonisation (DEBT→TECHNICAL_DEBT redirect, MASTER-PLAN bannière supersédé).
- **P0/M802/D6** : token Railway en clair rédigé (`MONITORING-PLAYBOOK.md:168` → `${RAILWAY_TOKEN}`). Rotation = ⛔ owner.

### Cluster sécurité P1 (commit a128bfd) — verify-then-fix contre le code réel
- **M406** connected-apps : `api_key` retiré des réponses GET + `@Roles('admin')`.
- **M203/M208** : `@Roles('admin')` sur GET org/units/stores (list+detail) ; non-admins gardent `/stores/me|accessible`.
- **M301/D12** : `otpCode` retiré de la réponse `POST /customers` ; 2 specs adaptées (lecture OTP via `otpStore`, pas la réponse).
- **M403/D5** : `POST /sync/push` scope `storeId` via `resolveStoreId(req,…)`.
- **Vérifs** : backend tsc ✅, jest **78 suites / 543** ✅ (zéro régression).

### M005 (commit b9fdebe)
- `SalePaymentDto` : `store_credit` whitelisté + `creditNoteCode` ajouté ; spec contrat DTO. tsc ✅, jest 37 (dto+sales) ✅.

### M704 — investigué, NON appliqué (env partagé)
- `@capacitor/preferences` manquant ⇒ customer-app tsc échoue. Fix **vérifié** (install → tsc exit 0) MAIS `npm install -w` depuis le worktree a **remplacé le symlink node_modules par un dir réel incomplet** → cassé backend/backoffice/pos/mobile (2159/52/279/64 erreurs). **Recovery** : symlink restauré + churn npm (package.json/lockfile) revert → 4 packages re-✅, customer-app re-1-erreur. Conclusion : manifeste déjà correct ; à résoudre par `npm install` dans un checkout normal (hors worktree symlinké). Aucun mute du store partagé.

### M108 (commit df08a09)
- La spec `test/stock-reconciliation.spec.ts` existait déjà (auditeur l'avait ratée — vérif source-of-truth). Ajout : boundary exact 19/20/21 % + chemin reject (no stock change, double-confirm refusé). jest 7/7.

### M803 (commit c65a89e) — doc refresh CLAUDE.md (safe)
- Inventaire factuel remis à jour : modules 37→42 (+documents/fiscal/pos-session/promo-codes/stock-reconciliation), entities 45→53, migrations 1716→1743, tests 405/49→543/81, pointeur DEBT→TECHNICAL_DEBT + bloc suivi vivant. Doc-only, aucune logique touchée.

### Gate de validation (recadrage périmètre POS)
- Safe autonome épuisé. P1 restants = SENSIBLES (fiscal verifyChain+migration / stock réel source unique / RGPD / receipts XSS) ⇒ STOP + demande de GO owner avant exécution.
- **GO owner reçu pour M006/M402 uniquement** (les 3 autres restent en attente, non touchés).

### M803 (commit c65a89e) — déjà journalisé plus haut.

### M006/M402 (commit 4355922) — durcissement chaîne, GO owner
- **Vérif source-of-truth** : le verifier fiscal (`FiscalVerifyService`) faisait DÉJÀ un recompute AUTORITATIF de `fiscal_journal` (payload verbatim) + détection fork/linkage, et `test/fiscal-verify.spec.ts` existait déjà (auditeur l'avait raté). Donc M006 = déjà couvert ; rien dupliqué.
- **M402 (vraie lacune)** : la v1 hachait `details` comme `{}` (bug replacer-array → tamper indétectable) + timestamp haché non persisté. Fix : `computeAuditHashV2` (canonicalisation récursive) + `hashed_at` persisté + recompute v2 dans `verifyChain` (v1 = linkage-only) + index unique anti-fork `(store_id, previous_hash)` + retry doLog + migration 1744 (avec pré-check anti-fork qui échoue bruyamment). Spec `test/audit-chain-verify.spec.ts` (tamper `details` détecté, linkage, v1 linkage-only, retry).
- **Différé volontairement** (sensible, sans GO spécifique) : index anti-fork sur `fiscal_journal` (toucherait la tx de void sans retry) ; recompute autoritatif sales/credit_notes (NF525 PARQUÉ).
- **Vérifs** : backend tsc clean, jest **80 suites / 553** (zéro régression).

### Revue owner M402 (2026-06-22) — sémantique d'échec confirmée + cadrage
- **#1 (décisif) CONFIRMÉ par code** : `AuditService.log` = **transaction séparée**, appels **post-commit** en vente, `try/catch → logger.warn`. ⇒ « op⟺audit » non garanti (pré-existant). M402 a changé fork-silencieux → retry+drop-loggué, sans toucher le couplage. Statut M402 **rétrogradé** : détection ✅ / couplage = lot ouvert (**D16** : décision archi in-tx vs alerte-sur-drop).
- **#2 CONFIRMÉ** : genesis = sentinel `'0'×64` (colonne `previous_hash` NOT NULL), pas NULL ⇒ index unique garantit bien mono-genesis/magasin. Réserve NULL non applicable.
- **#3 diagnostic prod (read-only, à exécuter avec accès prod — non dispo ici)** :
  `SELECT store_id, previous_hash, COUNT(*) FROM audit_entries GROUP BY 1,2 HAVING COUNT(*)>1;`
  (= détecte un fork d'audit DÉJÀ présent, appends concurrents passés ; conditionne aussi l'applicabilité de mig 1744). À lancer avant deploy. **D7-like : besoin accès prod.**
- **#4 → D17** : frontière v1 non-vérifiable documentée + question périmètre NF525 de la chaîne audit (owner/expert-comptable).
- **#5 → D4 reframe** : anti-fork fiscal = LOT OUVERT (design concurrence du void), pas « couvert ».
- **D9 (vérif lecture, autorisée)** : S2 XSS **remédié** (`esc()` correct sur toutes les chaînes des 2 builders HTML) ; résiduel non-exploitable `<title>` ticketNumber non-esc ; S3 public = par design (QR/UUID opaque, reprint/email authed). Aucun patch (lecture seule).

### D16 interim (commit 419b2fd) — alerte sur audit perdu (sûr, sans changer le couplage)
- `AlertService` : event `AUDIT_WRITE_FAILED` (severity critical). `doLog` : sur épuisement des retries anti-fork, **fire l'alerte avant de throw** (au lieu d'un simple WARN caller). Flux retry simplifié (erreurs non-conflit propagées immédiatement). Ne change PAS le couplage txn (décision archi D16 reste owner). Spec : l'alerte est levée à l'épuisement. tsc clean, jest **80 suites / 554** (zéro régression).

### Notes de décision produites (lecture seule, AUCUN code sensible touché)
- `docs/design/M107-stock-source-of-truth.md` : mécanisme exact de la divergence (ventes décrémentent la colonne legacy l.591 ; `syncLegacyStock` l.435 écrase `stock_quantity = SUM(balances)` → décréments de vente perdus). Stock hors chaîne fiscale. Options A/B/C + reco A+garde C. GO owner requis (choix + ce que lit le Z).
- `docs/design/M302-rgpd-nf525-policy.md` : **constat clé** — les ventes ne portent que `customer_id` (zéro PII) ⇒ anonymiser un client ne touche aucun enregistrement fiscal ; colonnes `deleted_at/anonymized_at` présentes mais sans logique. Décisions de politique à trancher (champs scrub, pseudonymisation, rétention, PII dans docs). GO owner requis (politique d'abord).

### Fix classe 3 — audit fantôme (commit f2b39b9, GO encadré owner)
- `stock.adjustStock` : la tx renvoie `{saved, oldQty}` ; audit émis APRÈS commit, best-effort.
- `coupon.redeemCoupon` : la tx renvoie `{response, auditPayload}` ; audit APRÈS commit, best-effort, UNIQUEMENT vraie redemption (replay cache → auditPayload null → pas de ré-audit).
- Non touché : montants/quantités/paiement/reçus/fiscal/archi. Tests avant/après : échec d'audit ne roll back plus l'op (stock+coupon), replay coupon ne ré-audite pas. tsc clean, jest **80 suites / 557** (zéro régression).

### Consolidation notes décision (lecture seule)
- **M107** : ajout « Consommateurs de stock_quantity » — valorisation analytique (`product-analytics.util:143` valeurStockMinorUnits), **garde de vente** (`sales.service:240`), alertes seuils ; **Z fiscal NON concerné** (agrège les ventes). ⇒ divergence = incident gestion/survente, pas fiscal ; nécessite **réconciliation one-shot** (valeurs déjà dérivées) = sensible, GO + human-validated.
- **M302** : ajout valeur de rétention **proposée 10 ans** (Code com. L123-22) **à confirmer comptable** ; portée réelle nulle aujourd'hui (zéro PII fiscale) ⇒ anonymisation implémentable sans attendre, carve-out factures seulement si factures nominatives générées.

### Continuité opérationnelle (nouvelle règle owner) — exécution autonome du réversible/testable
- **M302 (commit 1e07f51)** : `CustomersService.anonymize` (scrub PII en place + soft-delete + endpoint admin audité, @Optional audit). Zéro enregistrement fiscal touché (ventes = customer_id). 3 tests. Pas de migration (colonnes en 1712).
- **D9 (commit 5309908)** : `<title>` reçu vente échappé (`esc(ticketNumber)`) — S2 clos+durci. Non exploitable (valeur serveur), defense-in-depth.
- **M107 diagnostic (commit 0123cca)** : `findStockDivergences()` read-only + `GET /stock-locations/divergences` + spec. SQL plain SUM/GROUP BY (pg-mem-safe), delta/filter/sort en JS. Réconciliation one-shot (écrit le stock) reste prod-gated.
- **Vérifs** : à chaque étape backend tsc clean + jest (jusqu'à **80 suites / 561**, zéro régression). 5 commits séparés ce tour (class-3 f2b39b9, M302, D9, M107-diag + docs).

### Salve audit read-only secondaire (continuité)
- **M303 (commit 487ceb1)** : LoyaltyTokenService déjà solide (HMAC-SHA256, TTL 60s, payload sans PII, compare constant-time) → spec sécurité ajoutée (round-trip, sig falsifiée, mauvais secret/rotation, expiré, malformé). 5 tests.
- **M105 (commit d8ea297)** : garde anti **CSV formula injection** (CWE-1236) dans `toCsv` (cellule string commençant par = + - @ TAB CR → préfixe `'` ; nombres intacts) ; round-trip + brand/supplier déjà testés. Test ajouté.
- **D14 jackpot (commit 0f86f46)** : vérifié read-only → faux positif (roll serveur fail-closed, quotas/proba, config admin).
- **D18 / M207 stores.hardDelete** : finding réel documenté (purge ~16 tables, **~20 tables store_id non couvertes dont fiscal credit_notes/fiscal_journal**) → **non touché** (op destructive + fiscal + question rétention légale = décision owner/comptable).
- Vérifs à chaque étape : tsc clean + jest (jusqu'à **81 suites / 567**, zéro régression).

### Vérification adversariale (workflow 11 agents) + corrections — salve majeure
Revue adversariale de TOUS les fixes de la campagne (chaque agent tente de RÉFUTER) :
- ✅ confirmés : connected-apps api_key (GET), customers otpCode, store_credit path, M402 details-tamper, classe-3 phantom, M607 dead-claim.
- ❌ 3 vrais bugs trouvés + CORRIGÉS :
  - **A (af0fa24)** tenant : `/timewin/stores` (+ store-config/schedule/payroll) JWT-only → fuite multi-tenant + write cross-store schedule. Fix : `/stores` admin-only + resolveStoreId sur les endpoints storeId-param. +4 tests.
  - **B (73a2c23)** sync : per-row `storeId` sauvé verbatim → forge de ventes/clients cross-store. Fix : force storeId sur insert (dedup unscoped) + refus client cross-store. +3 tests.
  - **C (4f92555)** offline sync : payload non-DTO (ticketNumber/extras) → 400 forbidNonWhitelisted → ventes offline perdues ; + DTO ne whitelistait pas stripeReaderId/terminalId (400 carte même online). Fix : whitelist + `toSyncCreateBody` reshape. +tests be/pos.
- ⚠️ 4 caveats CORRIGÉS :
  - **D (5ed969f)** M402 : v2 hash couvre désormais storeId+employeeId → détecte la ré-attribution (pas de v3, v2 non déployé). +test.
  - **E (28c6493)** M105 : `stripFormulaGuard` à l'import → round-trip lossless (-40% Promo). +tests.
  - **F (28c6493)** M406 : api_key retiré aussi des réponses create/update/deactivate.
  - **G (4a4eb96)** M302 : Swagger mobile-auth DELETE /me trompeur corrigé ; PII cross-table (notifications_log.body + 2e chemin) documentée avant dé-gel.
- **D20** : mouvements stock-locations non audités (couverture) → documenté, additif.
- Vérifs : backend tsc clean, jest **81 suites / 583** ; pos tsc + vitest **82** ; zéro régression. ~7 commits.

### Prochaine action automatique (continuité)
Safe restant : audit read-only des modules ⚠️ (jackpot/loyalty/etc.) → confirmer/infirmer, garde-fous additifs + tests si bug évident. Vrais blocages : M107 réconciliation prod / décision A-B-C, D16-D17 archi, secrets/prod (#3, D6/D8/D7), Stripe parqué.

---

## 2026-07-16 — Journal de stock unifié / NF525 : F0 + F1 (GO owner nommé) — branche `feat/stock-journal-nf525-on-main`

### Synthèse décisionnelle (avant tout code)
- Reprise de `PRODUCTS_FISCAL_STOCK_ARCHITECTURE.md`, vérifiée fichier:ligne contre le code réel
  (4 explorations // : vente+void, journal fiscal+retours, sync/offline, session/terminal/employé).
- Livré `PRODUCTS_FISCAL_STOCK_SYNTHESIS.md` : 11 décisions + diagramme + inventaire schéma/endpoints.
- **GO owner en canal** : périmètre **F0 puis F1**, `store_id` sur le mouvement, `occurred_at`=oui,
  fix G3→**F2** (GO propre). Le « go » nu ne suffit pas (charte §0/§3) — décisions explicites exigées.

### F0 — liaison additive
- Migration `1767` additive/réversible : `stock_movements +=` store_id/sale_id/sale_line_item_id/occurred_at
  + index sale/store + **index unique partiel** `(sale_line_item_id, product_id, movement_type) WHERE sale_id NOT NULL`.
  Entité alignée (4 colonnes nullable). ZÉRO comportement, ZÉRO DDL fiscal.

### F1 — écriture double shadow
- Flag `STOCK_JOURNAL_SHADOW` **OFF par défaut**. ON : vente → `sale`(ligne)+`pack_consumption`(composant) ;
  retour → `return_customer` ; même tx ; lecture caisse inchangée. Vente = `sale_id` (idempotent via index F0) ;
  retour = lié par reference+note (retour partiel répété légitime). Union `movementType += 'pack_consumption'`.

### Découplage du catalogue (2026-07-16) — la branche de ce lot
- **Analyse de dépendance par diff** : intersection lot fiscal ∩ catalogue = **3 docs de suivi
  uniquement, aucun fichier de code**. Inventaire des tables : toutes présentes sur `origin/main`
  (stock_movements/1735, product_components+sale_component_movements/1754, fiscal_journal/1717,
  credit_notes/1714, audit/1744) ⇒ **lot fonctionnellement indépendant**.
- **Découplé** : branche `feat/stock-journal-nf525-on-main` depuis `origin/main`, cherry-pick des
  3 commits de code **sans conflit** (confirme l'indépendance), docs rejouées sur les versions main.
  L'ancienne branche empilée `feat/stock-journal-nf525` (43 commits, stack catalogue) reste **archive**.
- **Ordonnancement migrations vérifié** : base vierge → **40 migrations**, tête =
  `AddStockMovementSaleLinkage1767000000000` au-dessus de `1758` (trou 1759→1766 = accès+catalogue absents, sans effet).

### Vérifs (toutes sur cette branche, vrai Postgres base jetable, codes retour réels)
- pg-mem backend : **967 passed / 0** · exit 0 (112 suites ; les 11 suites catalogue/accès n'existent pas sur main).
- `stock-movement-linkage-migration` (F0 up/down/re-run) : **3/3** · exit 0.
- `stock-journal-shadow` (F1) : **5/5** · exit 0 — dont **HASH DE VENTE INCHANGÉ** (recalcul canonique stock-exclu == hash stocké).
- Non-régression fiscale flag OFF : `avoir-d14-atomicity` **1/1**, `fiscal-e2e` **1/1**,
  `product-packs-concurrency` **2/2**, `sales-stock-concurrency` **1/1** · exit 0.
- Instrument F3 `stock-reconciliation-readonly` : **3/3** · exit 0.

### Outils livrés (docs / lecture seule, sans GO)
- **`GO_F2_PACKAGE.md`** : dossiers de décision F2 (void inverse + G3, avant/après concret) et F1b
  (`inventory_adjust` shadow) — recommandation **delta signé** motivée + le test qui la prouve ;
  note d'indépendance/ordre de merge (aucun ordre catalogue→fiscal imposé).
- **`stock-reconciliation-readonly.pg.spec.ts`** : instrument de mesure F3, SELECT PUR.
- **Dette D22** (couverture shadow partielle ; D21 réservée à la branche accès non mergée).

**Restent gatés (GO nominatif)** : F2, F1b, F3 (bascule lecture + cutover), F4 (retrait legacy),
activation du flag hors test local, tout merge.
