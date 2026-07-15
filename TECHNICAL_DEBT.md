# TECHNICAL_DEBT.md — registre de dette nommée

> **Registre canonique** (supersède `DEBT.md`). Append-only. Une dette = un manque conscient,
> scopé — ni bug silencieux ni TODO perdu. Chaque entrée nomme *ce qui n'est pas couvert*,
> *pourquoi c'est différé*, *ce qui la ferme*. Fermer une dette = une PR qui retire son entrée.
> Les audits datés (`AUDIT-COMPLET.md`, `AUDIT-FINAL-2026-04-01.md`, `INCIDENT-REPORT-2026-04-01.md`)
> sont des snapshots immuables ; leurs findings ouverts vivent ICI.

Statuts : OPEN · IN PROGRESS · BLOCKED (owner/accès) · CLOSED (PR retire l'entrée).

---

## D1 — Reversal fiscal d'une vente **cash** via `createReturn` non couvert
**Status:** ✅ **CLOSED (D1.4 ratifiée + implémentée, GO owner 2026-07-08).** Modèle ratifié : credit_notes = pièce opposable (numéro séquentiel/magasin, HT/TVA/TTC, approbation cash) ; fiscal_journal = scellement immuable — 4 maillons chaînés dans la MÊME tx (`sale_original_referenced` → `credit_note_issued` → `stock_restored` → `cash_refund_recorded`). Atomicité totale prouvée sur VRAI Postgres (`avoir-d14-atomicity.pg.spec.ts`). Migration `1753` additive ; empreintes hash inchangées. **Since:** void-cash-realized guard (#10), 2026-06-12.

**Contexte.** Le guard `void-cash-realized` (`sales.service.ts` ~L933+) refuse de `void` une vente avec leg cash réalisé ; l'annulation doit passer par le **retour** (`createReturn`, remboursement cash). Le trou de sécu (voider du cash réalisé) est **fermé**.

**Ce que la spec de caractérisation PROUVE (2026-07-08).** `avoir-d1-cash-return.spec.ts` : le guard impose bien le chemin retour (D1.0) ; le retour cash produit un avoir `type=refund` **soldé** (remaining 0), **chaîné et auto-cohérent** sur l'allowlist canonique (D1.1) ; la vente d'origine reste **immuable** — statut/hash/total (D1.2) ; le stock est restauré (D1.3) ; le replay est idempotent (D1.5) ; le sur-retour est refusé (D1.6). **Aucun bug découvert.**

**Ce qui reste OUVERT (décision owner, épinglée par D1.4).** Un retour cash n'écrit **aucun** maillon `fiscal_journal` (contrairement au void/M4) : l'enregistrement opposable est aujourd'hui la chaîne `credit_notes`. Est-ce le modèle voulu au regard de D17 (« event opposable → fiscal_journal ») ou faut-il aussi un maillon journal (ventilation Z incluse) ? **Décision fiscal-design owner.** Le fait est verrouillé par le test D1.4 : tout changement silencieux casse la CI et doit venir avec la ratification.

**Ce qui la ferme.** Ratification owner de la sémantique (journal ou pas) → si changement : PR fiscale dédiée + mise à jour de D1.4 → retirer cette entrée. **Cross-refs.** `CLAUDE.md` Known Issues ; `avoir-d1-cash-return.spec.ts` ; `void-cash-realized-guard.spec.ts`, `avoir-m1-m3.spec.ts`, `void-m4-journal-chain.spec.ts`.

---

## D2 — connected-apps expose `api_key` + pas de scoping org  (M406) — ✅ P1 CLOSED (vérif code 2026-07-11)
**Status:** ✅ **CLOSED pour le P1 SÉCU** (exposition `api_key` + accès caissier). `connected-apps.controller.ts` : `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('admin')` sur TOUS les endpoints, et `api_key` **retiré de chaque réponse** (destructuring `{ apiKey, ...rest }` sur findAll/findOne/create/update/deactivate) ⇒ un non-admin n'accède pas, l'admin ne reçoit jamais la clé sur HTTP. Scoping org = sans objet (admin-only ; les admins accèdent à toutes les orgs par design).
**Résiduel P2 (non bloquant) :** la colonne `api_key` reste **en clair au repos** en base — chiffrement à terme (pattern airtable-ops). Distinct du P1 fermé.

## D3 — audit `verifyChain` ne recalcule pas le hash  (M402) — ✅ CLOSED (commit 4355922)
**Fermé** : la v1 hachait `details` comme `{}` (bug de replacer-array) ⇒ tamper indétectable, et le timestamp haché n'était pas persisté. M402 : `computeAuditHashV2` (canonicalisation récursive) + `hashed_at` persisté ⇒ `verifyChain` recompute les lignes v2 et détecte le tamper de `details` ; v1 = linkage-only (pas de faux positif) ; index unique `(store_id, previous_hash)` anti-fork + retry dans doLog ; migration 1744. Spec `test/audit-chain-verify.spec.ts`.

## D4 — fiscal `verifyChain` (fiscal_journal)  (M006) — recompute autoritatif ✅ ; anti-fork fiscal = LOT OUVERT
**Recompute `fiscal_journal` AUTORITATIF** (payload verbatim) + détection fork/linkage : déjà en place (`FiscalVerifyService`), prouvé par `test/fiscal-verify.spec.ts`. **LOT OUVERT explicite (PAS « couvert »)** — *asymétrie audit/fiscal* : l'anti-fork est par **construction** côté audit (index unique + retry) mais seulement par **détection** côté fiscal (la chaîne la plus réglementée). L'index unique `fiscal_journal (store_id, hash_chain_prev)` n'est PAS ajouté car il ferait rollback la **transaction de void** sur un fork concurrent **sans stratégie de retry** dans ce chemin → nécessite un **design concurrence du void** dédié (retry/relecture de tête dans la tx) + validation prod. **Différé, à nommer comme lot, pas comme fait.** (b) recompute autoritatif `sales`/`credit_notes` = **NF525-adjacent, PARQUÉ**.

## D5 — sync `POST /push` fait confiance à `payload.storeId`  (M403) — ✅ CLOSED (vérif code 2026-07-11)
**Status:** ✅ **CLOSED.** `sync.controller.ts` : `push` résout le magasin via `resolveStoreId(req, payload.storeId)` (non-admin ⇒ magasin du JWT, **Forbidden** si `payload.storeId` diffère ; admin peut cibler explicitement) puis appelle `syncService.push({ ...payload, storeId })` ; le service **force `storeId` sur chaque ligne insérée** (`s.storeId = payload.storeId`, ~L133) ⇒ aucun device ne peut écrire dans un autre magasin en spoofant `payload.storeId`. Aligné avec pull/status. (Distinct de la porte offline-sale PARQUÉE.)

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

**Sous-bug classe 3 (audit fantôme) — ✅ CLOSED (commit f2b39b9)** : `stock.adjustStock` + `coupon.redeemCoupon` audit APRÈS commit, best-effort. **Effet net : la chaîne `AuditService` est désormais UNIFORME** — tous les sites sont out-of-band best-effort (post-commit ou hors-tx) ; **plus aucun site mid-tx phantom**. La non-uniformité que classe-3 introduisait est *supprimée*, pas accrue.

**Modèle de couplage — désormais EXPLICITE (preuves code), pas accrété :**
- **Chaîne FISCALE = in-band fail-closed.** `fiscal_journal` est écrit par `queryRunner.manager.insert` (sales.service `:1244`) **dans** la tx de void, **avant** `commitTransaction` (`:1266`) ; le hash de vente est calculé in-tx. ⇒ si le fiscal échoue, la vente/void **rollback**. C'est le journal NF525, atomique avec l'opération.
- **Chaîne APPLICATIVE = out-of-band best-effort + alerte.** `AuditService` (connexion propre, jamais le `manager` appelant) = audit opérationnel, post-commit, best-effort, avec **alerte `AUDIT_WRITE_FAILED`** sur drop (commit 419b2fd).
⇒ « non-uniforme entre les deux *chaînes*, uniforme *dans* chaque chaîne ». Classe-3 **acte** ce modèle pour la chaîne applicative.

**✅ RATIFIÉ par l'owner (2026-06-22)** : `fiscal_journal` = in-band fail-closed, périmètre fiscal/NF525 ; `AuditService` = audit applicatif out-of-band best-effort + alerte, **hors NF525** sauf preuve contraire. Règle actée : **un événement fiscalement opposable doit aller dans `fiscal_journal`, pas seulement dans `AuditService`**. Le modèle est donc le contrat d'architecture ; classe-3 (uniformisation out-of-band de la chaîne applicative) est cohérente avec lui. **D16 = CLOSED (décision + implémentation alignées).**

## D17 — Périmètre NF525 de la chaîne d'audit + frontière v1  (M402) — ✅ RATIFIÉ (2026-06-22)
**Décision owner** : `AuditService` est un **audit applicatif interne, HORS périmètre NF525** (le journal fiscal de référence est `fiscal_journal`, in-band fail-closed). ⇒ la borne « `details` de l'historique **v1** non-recalculable (linkage-only) » n'est **pas** un écart de conformité NF525 — c'est une limite documentée de l'audit applicatif. M402 (v2 recompute) durcit le futur ; le passé v1 reste linkage-only, **acté comme borne**. **Conséquence opérationnelle** : tout événement devant être **fiscalement opposable** doit être écrit dans `fiscal_journal` (in-band), pas seulement loggué dans `AuditService`. **CLOSED.**

## D10 — Stripe : idempotency `Date.now()`, intent non lié, conflict no-op, EUR/taxRate20 en dur  (AUDIT-COMPLET)
**Status:** LARGEMENT FERMÉE (GO WisePad3, 2026-07-08) · reste EUR en dur (P2). **Fermé :** « intent non lié » → `verifyCardCaptureClaims` (sales.service) **prouve** chaque capture carte contre le PI Stripe réel (succeeded + storeId + amount_received) — PI fabriqué/étranger/non payé/insuffisant = vente refusée ; invérifiable = `payment_pending`, jamais « payé » (`card-capture-verify.spec.ts`, 9 cas). Idempotency PI = clé **déterministe serveur** (sha256 des inputs) — le `Date.now()` front n'est plus qu'un verrou local, jamais envoyé à Stripe. **Reste :** devise EUR figée côté PI (V1 France assumée — runbook `VALIDATION-WISEPAD3.md`, limites).

## D11 — Double source de vérité stock (legacy column vs stock_balances)  (M107) — diagnostic ✅, décision + réconciliation gated
**Status:** IN PROGRESS · **P1.** `product.stockQuantity` (décrémenté par les ventes) et `stock_balances` (écrasé dans la colonne par `syncLegacyStock`) divergent silencieusement. **Consommateurs** (vérifié) : valorisation analytique + garde de vente ; **Z fiscal NON concerné**. **Livré (commit 0123cca)** : `findStockDivergences()` read-only + endpoint `GET /stock-locations/divergences` (admin/manager) + spec → rapport d'écart sans mutation. **Reste** : (a) **décision** source unique A/B/C (`docs/design/M107-stock-source-of-truth.md`) = archi ; (b) **réconciliation one-shot** qui ÉCRIT le stock réel = **prod-gated** (validation avant exécution) ; (c) `CHECK(quantity>=0)`.

## D12 — customers `POST` renvoie `otpCode`  (M301) — ✅ CLOSED (vérif code 2026-07-12)
**Status:** ✅ **CLOSED.** Dérive doc : `customers.service.ts` `create()` retourne `{ customer, qrCodeDataUrl }` (L145) — l'OTP n'est **jamais** dans la réponse HTTP ; il n'est que loggué en dev (`this.logger.debug('[DEV OTP] …')`, L140, hors production). Aligné avec M301 (déjà coché `PROJECT_STATUS.md`). **Résiduel P2 (non bloquant) :** store OTP en Redis pour multi-instance (aujourd'hui table `customer_otps`).

## D13 — Effacement RGPD client  (M302) — ✅ CLOSED (commit 1e07f51)
**Fermé** : `CustomersService.anonymize(id)` scrub la PII EN PLACE (first/last/phone/email/password_hash + qr_code neutralisé `ANON-<id8>`), soft-delete (`deleted_at`+`anonymized_at`, colonnes déjà en mig 1712), idempotent, endpoint `POST /customers/:id/anonymize` admin-only + audité (metadata only). **Aucun enregistrement fiscal touché** (vérifié : ventes = customer_id seul). Tests : scrub+markers+conserve, idempotence, NotFound. **Reste (non bloquant)** : (P2) export de portabilité RGPD ; carve-out factures nominatives **seulement si** on génère des factures nominatives (durée 10 ans proposée, à confirmer comptable). **Élargi par revue adversariale (avant d'activer le flag)** : (a) scrub/null de `notifications_log.body` (porte `customerName`) pour le client anonymisé ; (b) router `mobile-auth DELETE /me` (aujourd'hui soft-delete seul ; Swagger trompeur corrigé) vers le pipeline d'anonymisation gelé.

## D14 — Jackpot « fallback silencieux »  (AUDIT-COMPLET, M306) — ✅ VÉRIFIÉ (lecture, 2026-06-22) : faux positif
**Vérifié** : `rollLottery` est **côté serveur**, **fail-closed** (pas de config / inactif → `no_win` enregistré, jamais de grant silencieux), borné par quota jour + densité + probabilité ; la config est `@Roles('admin')`. Le « fallback » = no_win = sûr. **Résiduels faible sévérité** (jeu **marketing**, pas d'argent/fiscal) : `Math.random()` (acceptable ici ; à durcir uniquement si un gain mappe une vraie valeur monétaire) ; `GET :storeId/config` non scopé tenant (config non sensible : URLs vidéo + probabilités). **Pas un trou >60%.** Aucun changement requis ; durcissements optionnels notés.

## D18 — `stores.hardDelete` laisse des orphelins (dont fiscal) + légalité  (M207) — ⛔ décision owner/légale
**Status:** OPEN · **P1 (impact données/fiscal/légal).** Vérifié en lecture (2026-06-22) : `hardDelete` purge une liste **tenue à la main** (`tablesWithStoreId` + `core` + sale-children ≈ 16 tables) mais **~20 tables avec `store_id` ne sont PAS couvertes** → orphelins après suppression d'un magasin. Notamment des **enregistrements fiscaux** : `credit_notes`, `credit_note_redemptions`, `fiscal_journal`, `pos_sessions` ; + `customer_visits`, `brands`, `suppliers`, `promo_codes`, `promo_code_redemptions`, `stock_variances`, `store_product_prices`, `timewin_events`, `price_history`, `product_store_availability`, `payment_terminals`, `sale_anomaly_logs`, `loyalty_reward_cycles`, `stock_locations`, `ai_recommendation_logs`, `airtable_*`.
**Pourquoi je n'y touche PAS en autonomie** : (1) c'est une **opération destructive irréversible** (suppression définitive) ; (2) elle purge déjà `sales` (donnée fiscale) et devrait/ne-devrait-pas purger `credit_notes`/`fiscal_journal` → **question de rétention légale NF525** (hard-delete de pièces fiscales ?) = **décision produit/légale non tranchée**. Ajouter des `DELETE FROM` ou retirer la purge fiscale modifie un flux destructif+fiscal → stop-list.
**Direction du fix (IMPORTANT — pas « compléter la liste »)** : sous NF525 les pièces fiscales sont à **conserver**. « Finir la liste des tables purgées » (réflexe naïf) **aggrave** : un `hardDelete` qui purge `fiscal_journal`/`credit_notes`/`sales` est probablement déjà une violation de rétention, orphelins ou pas. Le fix va dans l'**autre sens** : `hardDelete` doit **refuser / anonymize-and-retain** le fiscal (archivage du magasin, pas suppression des pièces). Ne **pas** ajouter de `DELETE FROM` fiscal.
**Ferme (owner + comptable)** : décider (a) si un `hardDelete` total doit exister pour un magasin à historique fiscal (vs soft-archive + rétention), (b) ce qui est purgeable (données non-fiscales orphelines : `customer_visits`, `price_history`, `airtable_*`…) vs **conservé** (tout le fiscal), (c) une fois tranché : implémentation + drift-guard test (les non-fiscales `store_id` sont couvertes ; les fiscales sont explicitement exclues).

## D20 — Mouvements stock-locations non audités (couverture)  — ✅ CLOSED (2026-07-12)
**Status:** ✅ **CLOSED.** L'injection morte est câblée : les 4 méthodes transactionnelles de `stock-locations.service` (`receiveFromSupplier` → `stock_supplier_receipt`, `transfer` → `stock_transfer`, `recordLoss` → `stock_loss`, `dispatch` → `stock_dispatch`) écrivent désormais une entrée d'audit applicative **post-commit best-effort** via un helper unique `auditMovement` (modèle ratifié D16/D17 : out-of-band, jamais bloquant). Détails portés : `entityType='stock_movement'`, ancien/nouveau solde(s), quantité, localisation(s), motif/type de perte, acteur (`employeeId`+`employeeName`) ; `storeId` résolu depuis le produit (tenant-scopé correct même pour un admin). Un échec d'audit **ne peut ni annuler ni faire échouer** un mouvement déjà committé (warn seul). **6 specs** ajoutées à `test/stock-locations.spec.ts` (une entrée par type de mouvement + old/new prouvés ; mouvement rejeté ⇒ zéro audit ; échec audit ⇒ mouvement quand même committé). Suite backend **959** verte.

## D19 — Couche HMAC sync = échafaudage MORT (sécurité-théâtre)  (M607) — ⚠️ feature gated
**Status:** OPEN · **P2.** Vérifié (2026-06-22, pos-desktop + backend) : `hmacSecurity.ts` annonce « Signature HMAC-SHA256 de chaque requête sync » mais la couche n'est **active nulle part** :
- `setStoreToken` **jamais appelé** → `getStoreToken()` = null → `signSyncRequest` renvoie **toujours null** → aucune requête signée ;
- `syncEngine` **ne pose pas** la signature en header (commentaire « In production: attach… » seulement, puis `salesApi.create(payload, idemKey)` sans signature) ;
- backend `/sync` ne **vérifie aucune** signature (aucun hmac/timingSafeEqual dans `modules/sync`).
**Pas un trou ouvert** : les requêtes sync portent le **JWT employé** (axios bearer) → authentifiées ; et le spoof `storeId` est déjà fermé serveur (D5/M403). Le risque réel = **faux sens de sécurité** (le code laisse croire que le sync est signé device-level). 
**Fait cette passe (sûr, non-fonctionnel)** : commentaires de `hmacSecurity.ts` + `syncEngine.ts` corrigés pour dire « NON CÂBLÉ → D19 ».
**Ferme (décision/design, chemin d'écriture sync — pas autonome)** : soit câbler end-to-end (provisioning token au login magasin + attach header + **vérif backend** + anti-replay nonce/timestamp + gestion du secret), soit retirer l'échafaudage si la device-signature n'est pas requise (JWT suffit). Toucher la vérif backend = chemin d'écriture sync → owner.

## D15 — Dérive doc CLAUDE.md + nits  (M803) — 🔄 IN PROGRESS (2026-07-12)
**Status:** IN PROGRESS · **P3.** Passe de rafraîchissement (2026-07-12) :
- ✅ **Liste des migrations** complétée dans `CLAUDE.md` (manquaient `1744-HardenAuditChain`, `1755-CreateAttractCampaigns`, `1756-AddPosMachineEnrollment`, `1757-AddStoreTw24Enabled`) → 38 migrations, à jour jusqu'à 1757.
- ✅ **Compteur de tests** rafraîchi (`543/81` → ~961 passants / 972 total sur 116 fichiers spec) aux 2 emplacements + note gated-PG.
- ✅ **Key Files** : `45 TypeORM entities` → 62 ; `11 versioned migrations` → 38 (→ 1757).
- ✅ **health** : commentaire code « strict 2s timeout » corrigé en « 5s » (aligné sur `HEALTH_DB_TIMEOUT_MS = 5000`).
- ✅ **Déjà résolus (dérive du registre, vérifiés)** : `migration:run` utilise `typeorm-ts-node-commonjs` (plus de `typeorm/cli.js` inexistant) ; `promo-codes` & `stock-reconciliation` **sont** documentés dans la table des modules.

**Résiduel (non fait — évite d'introduire une NOUVELLE incohérence)** : les en-têtes `## Backend Modules (42)` (réel 46) et `## TypeORM Entities (55)` (réel 62) sont suivis de **tables énumérées** ; bumper le seul chiffre sans réconcilier la table crée un écart pire → réconciliation complète des tables = passe dédiée. Restent aussi : barrel `entities/index.ts` (inoffensif), seeds PIN `1234/5678` littéraux, colonnes date Z vs KPI. **Ferme :** réconcilier les 2 tables énumérées + les 3 nits restants.

---

## D22 — Journal de stock unifié : couverture shadow PARTIELLE (F1) — la réconciliation n'est pas exhaustive
**Status:** OPEN (par conception, gaté). **Since:** F1, 2026-07-16, branche `feat/stock-journal-nf525-on-main`.
> *Numérotation : D21 est volontairement réservée à la branche accès/activité non mergée (évite une
> collision de numéro au merge) — même logique que le trou de migrations 1759→1766.*

**Contexte.** Le journal de stock unifié (`stock_movements` = source unique cible ; voir
`PRODUCTS_FISCAL_STOCK_SYNTHESIS.md`) est livré en **F0** (schéma additif, mig 1767) + **F1**
(écriture double *shadow*, flag `STOCK_JOURNAL_SHADOW` **OFF par défaut**). Le flag ON écrit les
mouvements **uniquement pour la vente et le retour**.

**Ce qui n'est PAS couvert (conscient, nommé).** Deux chemins mutent encore le scalaire
`products.stock_quantity` **sans** écrire de mouvement : (a) **`voidSale`** (mouvement inverse
`void` + fix G3 = bloc **F2**) ; (b) **`stock.adjustStock`** (`inventory_adjust` = bloc **F1b**).
**Conséquence directe :** tant que F1b + F2 ne sont pas livrés, une réconciliation
`scalaire vs SUM(mouvements)` **n'est pas exhaustive** — un écart non nul est *attendu* et
*explicable* par ces deux chemins (+ l'absence de solde d'ouverture avant le cutover F3).

**Instrument de mesure (livré, lecture seule).** `test/stock-reconciliation-readonly.pg.spec.ts`
+ la requête `RECONCILE_SQL` : par (magasin, produit), `gap = scalaire − SUM(mouvements signés)`.
**Propriété prouvée :** tant que seuls des chemins couverts tournent, `gap` reste constant ;
toute variation de `gap` = exactement l'effet des chemins non couverts. C'est le critère de
bascule **F3** (0 divergence après cutover + couverture complète).

**Ce qui la ferme.** Livraison de **F1b** (adjust shadow) + **F2** (void inverse) sous GO nominatifs
(dossier prêt : `GO_F2_PACKAGE.md`) → la réconciliation devient exhaustive → puis F3 (cutover solde
d'ouverture) atteint `gap → 0`. **Cross-refs.** `PRODUCTS_FISCAL_STOCK_SYNTHESIS.md`,
`GO_F2_PACKAGE.md`, `stock-journal-shadow.pg.spec.ts`, `stock-reconciliation-readonly.pg.spec.ts`.
**Rappel :** F1b/F2/F3/F4, activation du flag hors test local, et tout merge = Tier-2 (GO explicite).
