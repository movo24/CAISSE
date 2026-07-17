# PROJECT_STATUS.md — état live

> Tableau de bord du chantier modulaire. Détail modules : `MASTER_ROADMAP.md`. Dette : `TECHNICAL_DEBT.md`. Journal : `EXECUTION_LOG.md`.
> Dernière reconstruction : **2026-06-21** (audit 10 agents + vérification centrale). Branche : `feat/pos-caisse-build`.

## Vérification centrale (faits objectifs, 2026-06-21)
| Package | tsc | tests | note |
|---|---|---|---|
| backend | ✅ | jest **543** (81 fichiers) | +gated `*.pg.spec` skipped |
| backoffice-web | ✅ | vitest **12** (3 fichiers) | couverture mince |
| pos-desktop | ✅ | vitest **75** (11 fichiers) | |
| mobile | ✅ | vitest **5** (1 fichier) | réparé (6ce722c) |
| customer-app | ⛔ | 0 | dep `@capacitor/preferences` non installée (M704) |

## Répartition des 94 modules audités
✅ Fait **48** · ⚠️ À vérifier **27** · 🔄 En cours **12** · ⛔ Bloqué **4** · ⬜ À faire **3**

## Worklist P0 / P1 (ordre d'exécution)
> Cochée = livrée + vérifiée dans cette campagne. Voir EXECUTION_LOG pour les hash.

### P0
- [x] **M802** Rédiger le token Railway en clair (`MONITORING-PLAYBOOK.md:168`) — rotation effective = ⛔ owner (D6)
- [ ] **INC** Vérifier que la séparation des bases prod (postmortem 2026-04-01) est faite — sinon risque destruction shared-DB live (D7)

### P1 — Sécurité / authz (cluster prioritaire) — ✅ LIVRÉ (commit a128bfd)
- [x] **M406** connected-apps : `api_key` retiré des réponses + `@Roles('admin')` sur les GET
- [x] **M203/M208** Tenant : `@Roles('admin')` sur `GET /organizations`, `/units`, `/stores` (list)
- [x] **M301** customers : `otpCode` retiré de la réponse `POST /customers` (specs lisent l'OTP via le store)
- [x] **M403** sync : `POST /sync/push` confronte `payload.storeId` à `req.user` (resolveStoreId)
- [x] **S2/S3 (D9)** XSS receipts **remédié+durci** (esc partout + `<title>`, commit 5309908) ; S3 public = par design (QR/UUID). Reste S1 = rotation clés historique (D8, owner)

### P1 — Correctness / intégrité
- [x] **M005** sales DTO : `store_credit` whitelisté + `creditNoteCode` (commit b9fdebe)
- [x] **M402** audit : v2 recompute (couvre `details`) + `hashed_at` + index unique anti-fork + retry + migration 1744 + spec (commit 4355922) — GO owner
- [x] **M006** fiscal : recompute `fiscal_journal` autoritatif + spec **déjà présents** (auditeur les a ratés) ; sous-item index anti-fork fiscal_journal **différé** (toucherait la tx de void sans retry) ; recompute sales/credit_notes = NF525 PARQUÉ
- [~] **M107** stock : pré-design + **diagnostic read-only livré** (`findStockDivergences` + `GET /stock-locations/divergences`, commit 0123cca) ; reste = décision A/B/C + réconciliation one-shot (prod-gated)
- [x] **M108** réconciliation stock : spec déjà présente (auditeur l'a ratée) + ajout boundary 19/20/21 % & reject (commit df08a09)
- [~] **M302** RGPD : code livré PUIS **GELÉ** derrière `CUSTOMER_ANONYMIZE_ENABLED` (commit 7012e99 — correction discipline) ; sous-erase vérifié ≈ nul (PII confinée à `customers`). Reste = **politique champs + carve-out factures** (owner/comptable) avant activation du flag.
- [x] **D16 interim** : alerte `AUDIT_WRITE_FAILED` (419b2fd) + **fix classe-3 audit fantôme** (f2b39b9, stock.adjustStock + coupon.redeem → audit post-commit) ; décision archi globale reste owner

### P1 — Build / front
- [x] **M703** mobile : tsc réparé (commit 6ce722c) — vite-env.d.ts, vitest 5/5
- [~] **M704** customer-app : **fix vérifié** (installer `@capacitor/preferences@^6` → tsc vert) mais **NON applicable depuis ce worktree** : `node_modules` est un symlink partagé avec le checkout principal ; `npm install` ici casse le store partagé (testé + recovery effectué). Le manifeste déclare déjà la dep → résolu par `npm install` dans un checkout normal. Pas de bug code.
- [x] **M601** POS : branche succès TPE câblée (`startTpeWaiting` / `handleTpeResponse('success'|'refused'|'timeout')`, POSPage) — chemin desktop **étiqueté DÉMO** (carte réelle = pipeline iPad/WisePad 3, PR #25/#37).
- [x] **M603** POS : `creditNoteCode` porté par `toWirePayments` et inclus dans l'enqueue offline (`salePayload.ts`) — une vente `store_credit` hors-ligne se synchronise correctement.
- [~] **M607** POS : vérifié → couche HMAC sync **morte** (token jamais provisionné, header non posé, backend ne vérifie pas) ; commentaires trompeurs corrigés (6a05c0b, D19) ; sync authentifié par JWT. Câblage end-to-end = gated (chemin écriture sync).

## Employee System Score — score employé 100 % factuel (2026-07-07, PR #14)
> Objectif : chaque action POS rattachée à une session claire (employé + terminal + magasin + session + heure) ; score défendable basé uniquement sur des faits vérifiables. Jamais subjectif.

**Livré (branche `claude/customer-display-vertical-eolixp`)**
- [x] Backend `employee-score` (migration additive `1747`) : `employee_score_events` (ledger signé), `employee_score_rules` (poids surchargeables), `employee_score_daily` (agrégat recomputable). Règles V1 versionnées (50+ types, catégories 25/25/20/10/10/10, plafonds/jour, alertes). Calcul jour/semaine/année Europe/Paris. Cron nocturne (03:00) : SESSION_ABANDONED sur sessions jamais fermées + recompute. Endpoints me/detail/employee/alerts/recompute. Miroir audit immuable. **8 specs**, suite backend **834** verte.
- [x] POS : **bloc caissier actif VISIBLE en permanence** (« CAISSE DE : NOM · Session depuis HH:MM · Terminal · Score jour [couleur] ») + état « AUCUN CAISSIER CONNECTÉ » ; header iPad + desktop + overlay plein écran. Session POS ouverte au login (X-Terminal-Id) / fermée au logout / récupérée sur 409. Modale détail score (wording factuel). **6 specs** session/bandeau, suite pos-desktop **162** verte.

**Livré (suite)**
- [x] Intégrité de session : verrouillage APRÈS INACTIVITÉ (3 min, quel que soit le panier) → SESSION_LOCKED ; anti-switch silencieux (même employé → SESSION_UNLOCKED, différent → EMPLOYEE_SWITCHED avec fermeture/ouverture de session) ; boutons « Changer de caissier » + « Fermer ma caisse ».
- [x] Faits sensibles signés : remise (DISCOUNT_WITH_MANAGER_CODE / ABOVE_LIMIT / WITHOUT_AUTHORISATION), tiroir manuel (CASH_DRAWER_OPENED_MANUALLY), remboursement.
- [x] **Motif de remboursement OBLIGATOIRE** (front online+offline + DTO validé backend `POST /returns`) — persisté dans `credit_note.reason` + audit `sale_returned`, pas juste visuel → REFUND_WITH_REASON. Chemin offline/by-ticket/gift-card non impacté (résilience préservée).
- [x] Événements produit/stock signés côté backend (autoritatif) : UNKNOWN_BARCODE_SCANNED, PRODUCT_CREATION_REQUESTED_FROM_POS, PRODUCT_DUPLICATE_BLOCKED (product-integration) ; STOCK_CORRECTION_WITH_REASON (stock-reconciliation).

**Livré (suite — fiabilité)**
- [x] **Garde serveur `POST /employee-score/events`** (PR #16) : un fait sensible du chemin POS doit correspondre à une session active réelle du terminal (store+terminal+employé), sinon requalifié `ACTION_WITHOUT_VALID_SESSION`. Le `sessionId` client n'est plus cru sur parole.
- [x] **Binding vente→session** : migration additive/réversible `1748` (`sales.session_id` uuid + `sales.terminal_id` varchar, nullable, index partiel) ; résolution **serveur** via `X-Terminal-Id` (create + void) → liée à la session active du terminal seulement si elle appartient à l'employé, sinon `session_id` null (« session inconnue » auditable, jamais fabriquée). Colonnes **HORS empreinte fiscale** (v1/v2) → aucun ticket validé re-hashé. Chemin sync offline : binding client **refusé** (null forcé). Front POS : `X-Terminal-Id` posé sur create/void. **5 specs** dédiées, suite backend **852** verte.

**Livré (suite — comptage caisse)**
- [x] **Cash-count à la fermeture de session** (migration additive/réversible `1749`, champs cash nullable sur `pos_sessions`) : **attendu SERVEUR** (fond d'ouverture + ventes espèces de la session, dérivées via `session_id` — jamais déclarées par le client) **vs compté RÉEL** (seule valeur saisie), écart = compté − attendu. Rattaché à une vraie session + terminal + employé. Fond d'ouverture optionnel (null = inconnu, tracé). Écart matériel → événement de score `CASH_DIFFERENCE_*` (via `classifyCashDifference`, seuils env) + `CASH_COUNT_COMPLETED`, rattachés à la session. Audit `pos_session_cash_counted` décomposant attendu/compté/écart. Fermeture SANS comptage = comportement inchangé (résilience). Ne compte que les legs espèces capturés, hors ventes annulées. **6 specs** d'intégration, suite backend **858** verte ; API POS `close(sessionId, countedCash)` / `open(openingCash)` câblée.

**Livré (suite — UI comptage & manager)**
- [x] **Modale POS de comptage** à la fermeture (`CashCountModal`) : le caissier saisit UNIQUEMENT le compté (€→centimes) ; l'attendu/écart restent calculés serveur, jamais affichés comme modifiables ni envoyés. Option « Fermer sans compter ». `posStore.logout(counted)` → `close(sessionId, counted)`. Specs pos-desktop (source-invariants + close forwards counted), suite **173** verte.
- [x] **UI backoffice manager** (`/cash-sessions`, `CashSessionsPage`, manager/admin) : sessions récentes (caissier, terminal, ouverture/fermeture, attendu/compté/écart couleur), KPI (sessions comptées, écart cumulé, écarts matériels), file d'alertes score (72 h). Endpoint backend `GET /pos-sessions` (manager/admin, tenant-scoped) + `posSessionsApi`/`employeeScoreApi.alerts`. Suite backend **859** verte.

**Livré (suite — fermeture sans comptage encadrée)**
- [x] **« Fermer sans compter » encadré** (migration `1750` : `cash_count_skipped_reason` + `cash_count_skipped_at` sur `pos_sessions`) : la résilience technique est préservée (une fermeture silencieuse logout/abandon reste possible) mais un **skip explicite exige un motif** (min 3 car., DTO validé) → événement `CASH_COUNT_SKIPPED` (cash, pénalité mineure, alerte) rattaché session/terminal/employé + audit `pos_session_cash_count_skipped`. Jamais une échappatoire muette. Modale POS : le bouton révèle un champ motif obligatoire ; backoffice : badge « non compté » + motif. **2 specs** backend (skip motivé → événement/persistance ; fermeture silencieuse → aucun événement), invariants modale POS.

**Livré (suite — scores équipe + fix fuseau)**
- [x] **Tableau scores équipe** : endpoint `GET /employee-score/team` (manager/admin, tenant-scoped) → employés actifs du magasin (fenêtre) avec score jour + semaine (dérivés du ledger), volume d'événements, dernière activité, nom via dernière session ; trié du plus faible au plus fort (cas à regarder d'abord). Page backoffice `EmployeeScoresPage` (`/employee-scores`, manager) : badges couleur, KPI (actifs / à surveiller), fenêtre 7/30/90 j. **1 spec** d'intégration (agrégation, tri worst-first, tenant scoping).
- [x] **Fix fuseau minuit Paris** (`periodRange`/`recomputeDaily`/`recomputeAllForDate`) : les bornes jour/semaine/année sont désormais des instants UTC = minuit **Paris** (DST-aware via `parisMidnightUtc`), pas le fuseau du runner. Corrige un **bug réel** (un score « du jour » lu entre 22:00–24:00 UTC ratait les faits du jour) qui rendait `getTeamScores`/`getScore` faux près de minuit. Suite backend **862** verte, déterministe.

**Livré (suite — mouvements espèces probants + fin de shift TW24, PR #22)**
- [x] **Binding retours → session** (migration additive/réversible `1751`) : `credit_notes.session_id`/`terminal_id` résolus **serveur** via `X-Terminal-Id` (create + by-ticket ; replay offline après fermeture → null « session inconnue », jamais fabriqué). Colonnes **HORS empreinte** avoir ({code, storeId, originalSaleId, total, lines}) → aucun avoir re-hashé. Audit `sale_returned` enrichi (terminal/session/sessionBound). Front POS : header posé sur les deux endpoints.
- [x] **Attendu caisse corrigé** : `attendu = fond + ventes espèces − remboursements espèces rattachés à la session` (`pos_sessions.cash_refunds_minor_units`, dérivé serveur). Un remboursement cash NON rattaché n'est pas déduit → il apparaît dans l'écart (fait, pas approximation). Remboursement carte : jamais déduit. Décomposition dans l'audit + tooltip backoffice + colonne « Remb. espèces ».
- [x] **`REFUND_CREATED` autoritatif** (source `returns`, neutre) émis **uniquement** quand le retour est rattaché à une session vérifiée.
- [x] **Fin de shift TW24** : `shift-normalize.util` partagé parse défensivement `endsAt` + `employeeId` (variantes de clés) ; à l'ouverture de session, check fire-and-forget → `EMPLOYEE_SESSION_OPEN_AFTER_SHIFT_END` **uniquement si probant** (endsAt + employeeId présents, TOUS les shifts du jour terminés — coupure/2e service → rien ; TW24 down → rien ; jamais bloquant).
- [x] **Audit factuel** : aucun concept de cash-drop/retrait caisse n'existe dans le code — le remboursement espèces est aujourd'hui la seule sortie tiroir.

**Reste à faire (étapes suivantes, non bloquantes)**
- [ ] **Flux retrait caisse / cash-drop** : inexistant aujourd'hui — à concevoir comme un fait signé (session + motif + montant) si le besoin métier est confirmé (décision produit owner).
- [ ] **`EMPLOYEE_LOGIN_ON_SCHEDULE` / `OUTSIDE_SCHEDULE` / `LOGIN_AFTER_SHIFT_END`** : le check probant existe à l'ouverture de session ; l'étendre au login (avant session) est possible sur la même util.

## AUDIT GLOBAL POS TERRAIN (2026-07-08) — état réel module par module

> Audit factuel avec preuves `fichier:ligne` (5 agents read-only, zéro supposition). Légende :
> ✅ prêt terrain · 🔄 partiel · ⚠️ fragile/mock · ❌ manquant · ⛔ bloqué owner/décision.
> **Fait structurant** : le POS embarque DEUX implémentations parallèles — chemin **iPad**
> (`useCart`/`usePayment`, récent, sain) et chemin **desktop inline** (`POSPage.tsx`,
> ancien — **sécurisé et aligné par PR #26/#33/#34** : plus de faux ticket, remises
> transmises, impression OS réelle, tiroir honnête ; la carte réelle reste sur le pipeline
> iPad). La cible produit V1 = **iPad** (CLAUDE.md, Apple strategy).
> **Rafraîchi 2026-07-08 après la salve PR #24→#34** (idempotence, carte réelle, desktop
> sécurisé, impression/tiroir honnêtes, auth offline, onboarding catalogue, page Ventes,
> documents PDF, CI 3 suites).

| # | Module | Statut | Réalité (preuve) |
|---|--------|--------|------------------|
| 1 | POS dashboard caisse | 🔄 | iPad prêt (scan, panier, qty, suppression, inconnu→demande, TTC centimes). **Desktop inline sécurisé (PR #26)** : remises/promo transmises (`toSaleDiscountFields` + pré-validation décision 5), payload via `toWirePayments` |
| 2 | Sessions caisse (ouverture/fermeture) | ✅ (iPad) | Backend ✅ (γ invariant, comptage attendu/compté/écart, skip motivé, PR #18-#22). **Fond de caisse : UI POS livrée (PR #23)** — `CashOpenModal` à l'ouverture ; déclaration caissier une fois, correction manager/admin gated + auditée (migration 1752, `POST /pos-sessions/:id/opening-cash`), intégré à l'attendu, marqueur backoffice |
| 3 | Ventes | ✅ | Backend ✅ (hash v2, idempotence, session binding). iPad OK. `Idempotency-Key` sur la vente ONLINE (PR #24). **Faux ticket desktop supprimé (PR #26)** : échec réseau → file offline honnête (`OFF-…`, même clé d'idempotence) ; autre échec → erreur affichée, panier conservé, AUCUN ticket fabriqué, aucune confirmation |
| 4 | Paiements | 🔄 | Espèces ✅ (rendu `paymentMachine`, tiroir iPad). **Carte réelle câblée (PR #25)** : `useStripeTerminal` (WisePad 3) consommé par `usePayment` — mode `real` (Stripe configuré : PI lié à la clé d'idempotence vente, capture réelle, leg `stripePaymentIntentId`), mode `demo` (build dev sans Stripe : étiqueté DÉMO, leg `pendingCapture=true` → vente `payment_pending`, jamais « payée »), mode `disabled` (prod sans Stripe : bouton carte = erreur claire, fail-closed). Invariant code : un leg carte ne se commit qu'avec des faits de capture (`cardLegRef`). ⚠️ Reste : test matériel WisePad 3 physique (aucun device ici) ; chemin desktop inline (PR #26) |
| 5 | Retours / remboursements | ✅ | Online + offline, motif obligatoire, idempotence, session-bound serveur, cash déduit de l'attendu (PR #22). **D1.4 ratifiée + implémentée (GO owner)** : avoir = pièce opposable (numéro séquentiel/magasin, HT/TVA/TTC, approbation manager cash) ; **4 maillons `fiscal_journal` scellés dans la même tx** (référence vente / émission / stock / sortie cash) ; **atomicité totale prouvée sur vrai Postgres** ; UI backoffice « Créer un retour / avoir » depuis la vente (lignes éligibles, motif, mode, historique, PDF). Pas de capture TPE pour le remboursement carte (cohérent avec #4) ; bundles = sans objet (aucune nomenclature au catalogue) |
| 6 | Stock | ✅/⚠️ | Décrément/restore atomiques dans les tx. Réconciliation ≥20 % complète (backend+UI+rôles). ✅ **Correction doc (2026-07-12)** : l'alerte de seuil AU MOMENT de la vente **existe bien** — `createSale` appelle `computeStockAlerts` + `logStockAlertsAsync` (`sales.service.ts:1081-1084`) → audit `stock_adjustment` (level alert/critical/out_of_stock) **+ push TW24 aux managers**, post-commit fire-and-forget (l'ancienne mention « alertes par polling uniquement » était **fausse**). ⚠️ Résiduel mineur : le calcul n'est **pas edge-triggered** (ré-alerte à chaque vente tant que le stock reste sous le seuil → bruit d'audit + pushs TW24 répétés) et le log n'est pas attendu ; seuils absolus 10/5, pas de « règle 20 % » stock bas. Dédup edge-triggered = décision cadence de notification manager (owner) |
| 7 | Produits / SKU / variantes | ✅ | CRUD, anti-doublon EAN (index unique DB + 409), variantes complètes, création POS interdite serveur (PIN manager sinon 403, `product-integration.service.ts:247-271`) |
| 8 | Prix magasin | ✅ | `resolveEffectivePrice` réellement appelé dans le chemin de vente (`sales.service.ts:262`), historisé + audité |
| 9 | Scanner code-barres | 🔄 | Douchette = input focalisé + Enter (fragile si perte de focus, pas de debounce) ; le listener document dédié existe mais est **mort** (`startBarcodeListener` jamais appelé). Caméra ZXing réelle ; douchette BT réelle (iPad) |
| 10 | Imprimante ticket | ✅/⚠️ | ESC/POS Bluetooth **réel, monté iPad** — chemin V1 prioritaire. **Impression honnête (PR #27)** : statut par vente (`printed`/`print_failed`/`no_printer`) affiché, jamais de faux succès. **Desktop réel (PR #33)** : `electronAPI` enfin exposé (préload étroit : `getPrinters` + `printTicketHtml`), impression **silencieuse via le spooler OS** (fenêtre cachée sandboxée, reçu HTML 80 mm échappé, timeout 20 s, échec → `ok:false` honnête). ⚠️ Reste : test sur imprimante thermique physique Windows (aucun device ici) ; kick tiroir USB desktop non couvert (BT iPad seulement) |
| 11 | Tiroir caisse | ✅/⚠️ | Kick RJ11 réel via imprimante BT (iPad, auto sur espèces). **Desktop honnête (PR #34)** : plus de faux succès « kick pulse sent » ni de tiroir `printer_kick` inventé sur tout poste Electron — statut `none`, kick refusé avec `false` honnête ; seul un kick BT réel retourne `true`. Chantier kick USB desktop = feature future documentée |
| 12 | Rapports | 🔄 | X/Z/journalier/période/analytics/trend backend ✅ + ReportsPage. Onglet « Analytique » = placeholder (mais Performance page consomme analytics/trend). **PDF branchés (PR #31)** : `DocumentsModule` enregistré + routes JWT tenant-scopées — `GET /documents/sales/:id/duplicata`, `GET /documents/credit-notes/:id/justificatif`, `GET /documents/z-reports/:date` (manager/admin, **lit un Z scellé existant, 404 sinon — jamais de génération implicite**) ; rendu verbatim (aucun recalcul, règle fiscale du PdfService) |
| 13 | Backoffice manager/admin | 🔄 | Sessions/écarts ✅, scores équipe+alertes ✅, produits/stock ✅, réconciliation ✅. **Pas de page Ventes** (list/détail/void backend sans UI). Filtres employé/terminal absents (colonnes seulement). Import CSV backend validé **sans UI**. Garde de rôle front = nav-hide (le serveur tient via `@Roles`) |
| 14 | Employés / droits | ✅ | Serveur ✅ (PIN bcrypt, rotation refresh + anti-replay, lockout par IP, hiérarchie rôles, audit chaîné). **Auth offline V1 (PR #28)** : cache local salé SHA-256 armé UNIQUEMENT après auth online réussie, expiration stricte 24 h, 5 échecs = entrée brûlée, **titulaire uniquement** (pas de switch offline), rôle plafonné `cashier` (aucun droit inventé), unlock journalisé en file durable → `SESSION_UNLOCKED_OFFLINE` au resync. QR badge = TW24 online-only (inchangé) |
| 15 | TimeWin24 | 🔄 | Proxy réel : HMAC+Bearer, circuit breaker, push idempotent, stores/shifts feeds, fin de shift probante (PR #22). Défaut = **local-first** (`POS_AUTH_AUTHORITY='caisse'`). Dépend du service TW24 externe + env vars (sans elles : « disabled » cosmétique, appels vers localhost:3000) |
| 16 | Comptamax24 | ❌⛔ | **Zéro code** (grep exhaustif). Parqué par design : SaaS séparé consommant des exports/API — rien à auditer |
| 17 | Mobile inventaire | 🔄 | App réelle (scan ZXing, offline queue idb + syncEngine, auth PIN) mais 1 seul fichier de test. **Doc drift : CLAUDE.md l'étiquette « Wesley Club loyalty »** — la vraie app fidélité est `customer-app` (⛔ build sur simple `npm install`, 0 test). « Pay24 Max » / « Analytik R » : n'existent nulle part dans le repo |
| 18 | Déploiement Railway/Vercel | ⛔ | Railway : **déploiement manuel obligatoire** (webhook impossible) + token owner. **DNS `api.addxintelligence.com` NON cut-over alors que les 3 `vercel.json` réécrivent `/api/*` vers ce domaine** ; ancien CNAME = service mort → pas de rollback. Vercel sert la **PWA** du POS (pas le .exe). `.exe` **non signé**, **pas d'auto-update**. Seed dev-only ; onboarding catalogue réel = import CSV… sans UI |
| 19 | Tests / CI | ✅/⚠️ | Backend ✅ (904 verts pg-mem). CI = 3 suites (PR #32) + **specs pg RÉELS (bloc TEST_DATABASE_URL)** : service container Postgres 16 jetable (job-scoped, aucun secret GitHub), étape dédiée `--runInBand`. **Leur premier run a révélé et fait corriger 2 bugs prod réels** : cap promo jamais déclenché sur vrai PG (parsing `UPDATE…RETURNING` TypeORM → `returningRows`) et **sur-vente stock sous concurrence** (check pré-tx périmé + `GREATEST` → décrément conditionnel race-safe). Reste hors CI : e2e Playwright smoke, tests périphériques |
| 20 | Risques terrain | — | Voir top 10 ci-dessous |

### Pourcentage réaliste d'avancement POS complet (rafraîchi post-PR #24→#34, 2026-07-08)
- Backend métier (ventes/fiscal/sessions/score/retours/stock/documents PDF) : **~92 %**
- POS chemin iPad (cible V1) : **~90 %** — carte réelle câblée (validation WisePad 3 physique restante), fond de caisse ✅, auth offline V1 ✅, impression honnête ✅, idempotence online ✅
- POS chemin desktop : **~75 %** — sécurisé (plus de faux ticket, remises transmises, offline honnête), impression OS réelle (PR #33, validation imprimante physique restante), tiroir honnête ; carte réelle = renvoyée vers iPad (pas de flux lecteur legacy)
- Matériel : **~70 %** — BT iPad réel + spooler OS desktop câblés ; **0 test sur device physique** (imprimante Windows, WisePad 3) ; kick tiroir USB desktop absent (honnête)
- Backoffice : **~85 %** — page Ventes ✅, import CSV catalogue ✅, sessions/écarts/scores ✅
- Intégrations : **~40 %** (inchangé — TW24 env-gated, Stripe clé prod manquante) · Déploiement : **~40 %** (owner-gated, inchangé)
- **Global « prêt magasin » : ~80 %** — un magasin iPad (espèces + imprimante BT + fond de caisse + auth offline + carte si Stripe configuré) est opérationnel de bout en bout côté logiciel. **Les bloquants restants ne sont plus du code** : validation matérielle (WisePad 3, imprimante thermique Windows), clé Stripe prod, DNS cutover + déploiement Railway, distribution (.exe non signé / iPad PWA).

### TOP 10 blocages avant mise en magasin (ordre de gravité)
1. ~~**P0 — Paiement carte impossible**~~ ✅ **CÂBLÉ (PR #25) + VÉRIFIÉ SERVEUR (PR #37, GO WisePad3)** : gate 3 modes + `verifyCardCaptureClaims` — toute capture carte revendiquée est **prouvée** contre le PaymentIntent Stripe réel (succeeded, magasin propriétaire, montant reçu) ; PI fabriqué/étranger/non payé = **vente refusée** ; invérifiable (pas de PI, Stripe absent/down) = `payment_pending` honnête. ⚠️ Validation matérielle restante = runbook `packages/backend/VALIDATION-WISEPAD3.md` (device + clé prod, owner).
2. ~~**P0 — Desktop : faux succès sur échec de vente**~~ ✅ **RÉSOLU (PR #26)** : plus aucun ticket fabriqué — échec réseau → file offline honnête (`OFF-…`, clé d'idempotence conservée, `SALE_OFFLINE`) ; autre échec → message d'erreur, panier conservé, retry avec la même clé.
3. ~~**P0 — Desktop : remises non transmises**~~ ✅ **RÉSOLU (PR #26)** : `toSaleDiscountFields` + `toWirePayments` sur le chemin inline, pré-validation remise (miroir décision 5). Carte inline gated : prod sans Stripe = désactivée ; Stripe configuré = renvoyée vers le pipeline aligné iPad/WisePad 3 (pas de 2e flux lecteur parallèle) ; dev = DÉMO étiquetée, leg `pendingCapture` → `payment_pending`.
4. ~~**P0 — Aucune impression ticket sur desktop**~~ ✅ **TRAITÉ EN HONNÊTETÉ (PR #27, cible V1 = iPad+BT)** : le desktop ne peut toujours pas imprimer (electronAPI mort — câblage USB = chantier hors V1) mais **le dit clairement** sur chaque confirmation de vente ; l'auto-print iPad n'ouvre plus jamais la boîte de dialogue en cas d'échec thermique (statut `print_failed` affiché, réimpression via l'historique). Aucune fausse impression possible.
5. ~~**P0/P1 — Fond de caisse sans UI POS**~~ ✅ **RÉSOLU (PR #23)** : `CashOpenModal` à l'ouverture ; déclaration caissier une fois puis immuable ; correction manager/admin gated + auditée (`setOpeningCash`, migration 1752) ; intégré à l'attendu ; marqueur backoffice.
6. ~~**P1 — Aucune auth employé offline**~~ ✅ **RÉSOLU (PR #28, V1 sécurisée/limitée/traçable)** : déverrouillage hors ligne du titulaire via cache PIN salé (jamais en clair), armé seulement après auth online, TTL strict 24 h, anti-brute-force (5 → brûlé), rôle plafonné cashier, fallback déclenché UNIQUEMENT sur erreur réseau (jamais sur 401), trace `SESSION_UNLOCKED_OFFLINE` synchronisée au retour online.
7. **⛔ P1 — DNS non cut-over + déploiement Railway manuel** : les fronts déployés pointent vers un domaine inactif ; pas de rollback. GO owner requis.
8. ~~**P1 — Pas d'`Idempotency-Key` sur la vente online**~~ ✅ **RÉSOLU (PR #24)** : clé client stable par encaissement (`newIdempotencyKey` + `saleIdemKeyRef`), envoyée en en-tête `Idempotency-Key` sur les deux chemins (hooks iPad + desktop inline), réinitialisée après confirmation, et **portée dans l'enqueue offline** pour qu'un create à réponse perdue soit dédupliqué et non dupliqué. Backend `createSale` déjà idempotent (fast-path replay + recheck in-tx + clé persistée, expiry 7 j). Tests : `sale-idempotency.spec.ts` (backend pg-mem : même clé → 1 vente + ticket rejoué ; clés distinctes → ventes distinctes), `idempotency.test.ts` (pos-desktop : unicité/format + invariants de câblage source).
9. ~~**P1 — Onboarding catalogue magasin**~~ ✅ **RÉSOLU (PR #29)** : UI d'import CSV sur la page Produits (backoffice, manager/admin) branchée sur l'endpoint serveur validé (`POST /products/import`, upsert par EAN, validation par ligne) ; **rapport honnête affiché** (lues/créés/mis à jour/ignorés + table des lignes en erreur — rien d'ignoré silencieusement) ; bouton « Modèle / Export serveur » = CSV canonique **round-trippable** ; liste rafraîchie post-import.
10. ~~**P1 — Couverture CI incomplète**~~ ✅ **RÉSOLU pour les suites unitaires (PR #32)** : vitest pos-desktop + backoffice ajoutés au job `verify` (toute régression front casse désormais la CI). Reste hors CI (documenté, non bloquant) : specs pg réels (`TEST_DATABASE_URL`), e2e Playwright, périphériques. ~~PDF documents non branchés~~ ✅ **RÉSOLU (PR #31)** : `DocumentsModule` enregistré, 3 routes JWT tenant-scopées (duplicata / justificatif avoir / export Z lecture-seule). ~~Page Ventes backoffice absente~~ ✅ **RÉSOLU (PR #30)** : `/sales` (minRole manager) — liste (filtres jour/statut/recherche caissier-terminal), KPI, détail ticket (legs de paiement, « NON capturé » affiché), **void manager à motif obligatoire** ; les refus des gardes fiscales serveur (espèces réalisées → avoir) sont affichés tels quels, jamais contournés.

### Prochaine PR recommandée
**ROADMAP TERRAIN #24→#30 INTÉGRALEMENT LIVRÉE** : #24 idempotence vente ✅ · #25 carte réelle WisePad 3 ✅ · #26 desktop sécurisé ✅ · #27 impression honnête ✅ · #28 auth offline V1 ✅ · #29 onboarding catalogue ✅ · #30 page Ventes ✅. Restent (hors roadmap, owner-gated ou chantiers dédiés) : validation matérielle WisePad 3 + clé Stripe prod ; DNS cutover + déploiement Railway ; impression USB desktop (V1 = iPad+BT) ; `DocumentsModule` PDF ; couverture CI front/e2e.

## Bloqués réels (⛔) — préparés, attente owner/accès
- **D6** Rotation token Railway (accès Railway = owner)
- **D8** Rotation des clés fuitées dans l'historique git (AUDIT-FINAL S1) — accès secrets + réécriture historique = owner
- **M310 / M509** Subscriptions/Billing Stripe = domaine PARQUÉ + env Stripe absent
- **DNS cutover / déploiement Railway** = GO owner explicite requis (jamais auto)

## Parqué (STOP volontaire — ne pas construire)
NF525 Z-seal · Comptamax export comptable · porte offline-sale · onboarding/pricing SaaS.

## Salve audit read-only secondaire (continuité, 2026-06-22)
- [x] **M303** loyalty QR token : vérifié sain (HMAC/TTL/constant-time) + spec sécurité (487ceb1)
- [x] **M105** CSV : garde anti formula-injection CWE-1236 dans `toCsv` (d8ea297) ; round-trip+brand/supplier déjà testés
- [x] **M306/D14** jackpot : vérifié read-only → faux positif (fail-closed serveur)
- [⛔] **M207/D18** stores.hardDelete : ~20 tables `store_id` orphelines dont fiscal → **décision owner/comptable** (destructif+fiscal+rétention légale), non touché

## Reste vraiment bloqué (vrai danger / décision / credential — pas prudence administrative)
- **M107 réconciliation one-shot** : ÉCRIT le stock réel → **validation prod requise** avant exécution (le diagnostic read-only est livré). + **choix A/B/C** = décision archi.
- ✅ **D16/D17 RATIFIÉS** (owner 2026-06-22) : fiscal_journal in-band fail-closed (NF525) ; AuditService out-of-band best-effort + alerte (hors NF525) ; event opposable → fiscal_journal. Modèle = contrat ; classe-3 cohérente. CLOSED.
- **D6/D8** rotations de secrets (token Railway, clés historique git) · **D7** séparation bases prod · **DNS/déploiement** : credential/accès prod owner.
- **#3** diagnostic fork audit prod : besoin accès prod (requête read-only fournie).
- **M310/M509** Stripe billing = PARQUÉ + env absent.

## Blocs GO livrés depuis (2026-07-08 → 2026-07-09)
- ✅ **GO WisePad3/Stripe prod** (PR #37) · **GO TEST_DATABASE_URL** (PR #38, +2 bugs prod prouvés/corrigés) · **GO D1.4** (PR #39, scellement fiscal des avoirs) · **GO Railway preflight** (PR #40) · **GO Railway live** (PR #41 + workflow CI) : **le commit main tourne EN PROD live** (deployment `a23cfe97`, health 200, smoke 401/400/201/200, migrations OK, `ALLOW_INMEMORY_CACHE=true` créé sur GO explicite). Prochain verrou : **GO DNS** (prod vivante = condition remplie).
- ✅ **GO Product Packs** (2026-07-09) : produits composés — composition `product_components` (anti-boucle BFS), décrément composants race-safe dans la tx de vente, snapshot figé `sale_component_movements` (retours au prorata selon le snapshot, jamais la composition courante), maillon `stock_restored` enrichi, section Pack fiche produit backoffice, 12 specs pg-mem + 2 specs vrai-PG (deltas exacts, concurrence 5/10, atomicité).

## Campagne 2026-07-11 — écran client, enrôlement, TW24 par magasin, distribution Windows

> Salve livrée + mergée dans `main` + déployée (Backend B live, smoke + E2E verts).

- ✅ **Bloc 4 — écran client attract** (PR #48→#52, mergées) : identité The Wesley's, backend campagnes/playlists, consommation playlist, backoffice de gestion. Migration `1755` déployée.
- ✅ **Windows field mission** (PR #53→#57, mergées) : audit terrain (#53), **mise à jour automatique** electron-updater + GitHub Releases (#54), **tiroir-caisse RAW ESC/POS + diagnostic imprimante** (#55), **Dashboard opérationnel vrais chiffres** (#56), **impression ticket + tiroir dans le flux de vente réel, durci P0** (#57).
- ✅ **P0 — clé d'idempotence périphériques auditée** (#57) : `ticketNumber` **rejeté** (séquentiel par magasin, repli client collisionnable) → identité stable = `saleId` (`sale-<uuid>`), gardes **par action** persistées (`AUTO_PRINT` / `AUTO_DRAWER_OPEN`, statuts dispatching/completed/failed), verrou d'exécution séparé du registre d'actions, cas incertain (crash) jamais rejoué.
- ✅ **Partie B — enrôlement machine** (PR #58, mergée) : entité `pos_machines`, migration `1756` **exécutée** (déploiement), module `machine-enrollment` (request/status/approve/reject/revoke), barrière de vente `assertMachineEnrolled` (feature-flag `stores.enrollment_enforced`, **défaut false**), back-office de validation, POS desktop (machineId stable, écran d'attente, header `X-Machine-Id`).
- ✅ **Partie C — toggle TW24 par magasin** (PR #60, mergée) : `stores.tw24_enabled` (**défaut false — opt-in**, migration `1757` **exécutée**), gate en tête de `pushEvent` (skip silencieux si désactivé), bouton Dashboard admin. TW24 **OFF partout par défaut** → aucun événement avant activation explicite.
- ✅ **Distribution Windows** (PR #59, mergée) : `electron-builder` **The Wesley's POS** (appId `com.thewesleys.pos`, `The-Wesleys-POS-Setup-x64.exe`), **Release GitHub `v1.0.0` publiée** (installeur + `latest.yml` + `.blockmap` + portable).
- ✅ **Auto-update R2** (PR #61, **mergée**) : feed sur stockage dédié (dépôt privé sans token embarqué), gating `vars.POS_UPDATE_URL` (absent ⇒ comportement inchangé, Release GitHub seule). **Auto-update R2 : code mergé, activation et test terrain en attente de la configuration infrastructure owner** (5 valeurs : `POS_UPDATE_URL` variable + `R2_ENDPOINT`/`R2_BUCKET`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` secrets). Voir `packages/pos-desktop/AUTO_UPDATE_DISTRIBUTION.md`. Aucune surveillance automatique armée.
- ✅ **M9 — douchette wedge globale** (PR #62, mergée) : `startBarcodeListener` (code mort) câblé dans POSPage → scan capté hors focus, garde pure `shouldAcceptWedgeScan`.
- ✅ **D20 — audit mouvements stock-locations** (branche `claude/stock-locations-audit`) : réception/transfert/perte/dispatch écrivent une entrée d'audit applicative post-commit best-effort (injection `AuditService` auparavant morte). +6 specs, suite backend 959 verte.
- ✅ **Réconciliation dette** : **D12** (`POST /customers` OTP) était OPEN mais **déjà corrigé dans le code** (réponse = `{customer, qrCodeDataUrl}`, OTP log dev-only) → CLOSED. **D20** → CLOSED.

### Réconciliation registre de dette (2026-07-11)
Audit code : **D2** (connected-apps `api_key`) et **D5** (sync `push` storeId) étaient marqués OPEN mais sont **corrigés dans le code** → passés CLOSED (D2 garde un résiduel P2 = chiffrement au repos). **M601/M603** vérifiés livrés. Les cases ci-dessus reflètent l'état réel.

## Prochaine action automatique (continuité)
**L'espace « safe » est de nouveau épuisé (2026-07-11, post campagne écran client / Parties B-C / distribution).**
Tout le restant est Tier-2 / owner-gated / matériel : **5 valeurs R2** pour l'auto-update (PR #61),
validation WisePad 3 + clé Stripe prod (GO owner), DNS cutover + déploiement Railway (GO owner explicite),
`TEST_DATABASE_URL` pour les specs pg/e2e en CI (décision infra), rotations de secrets D6/D8,
réconciliation stock one-shot (écrit le stock réel — validation prod), **certificat de signature `.exe`**.
Chaque action attend son GO nommé — aucune ne s'ouvre sur un « continue » générique (charte §0).

---

## Feature — Accès magasins + journal d'activité (2026-07-15) — branche `feat/mobile-access-and-activity-audit`

RBAC pilotage par magasin + journal d'activité + audit immuable des droits. Branche depuis `origin/main`
propre. **12 commits · aucun merge (Tier-2, GO requis).**

- **Backend** — ✅ jest **1026/0** (+48) ; 6 migrations up/down/up prouvées sur vrai Postgres 16 ;
  10 gated PG verts (dont `access-activity-migrations 3/3`).
- **Frontend** — ✅ `SecurityAccessPage` 4 onglets + télémétrie ; tsc 0 + build Vite 0.
- **Vérif LIVE (D21 ✅ CLOSED, 2026-07-15)** — stack réelle : 4 onglets exercés au navigateur avec
  données réelles, 403 codes/périmètre/suspension/expiration/gate admin prouvés, **0 secret** en télémétrie.
  2 bugs trouvés en live (filtre code métier ; validUntil:null) **corrigés + re-vérifiés** (commit `941a3ad`).
- **Verdict : TERMINÉ ET VALIDÉ** (réserves : merge `main` = Tier-2 GO owner ; captures = fichiers en session,
  pas PNG disque — limitation outil). Détails : `docs/design/access-activity-audit-deliverables.md`.
- Rôle POS `cashier/manager/admin` **inchangé** ; `application_role` = dimension séparée.

## Fiche produit ERP — P-A + P-B (2026-07-16)

Branche `feat/product-sheet-erp-pa` (**poussée sur `origin`**), stackée sur `feat/catalog-refonte`.
Spec : `docs/design/product-sheet-erp.md` (`bd4179b`), arbitrages **D-FP1→D-FP5** validés.

- **P-A/M-A** (mig `1768`) : 14 champs `products` (cycle de vie commercial distinct du statut,
  fabricant, libellé ticket, désignation longue, poids net, planif. stock, emplacement, étiquettes)
  + fiche backoffice câblée + journal M-E. **P-B** (mig `1769`) : `product_media.kind` + **1 image
  principale/produit** (index unique partiel) ; **unicité catégorie** (store/parent/nom) en renfort ;
  arbre **illimité SANS colonne `level`** ; CategoryPicker (recherche chemin + création inline).
- **Vérif** : backend **1084/0**, frontend **84/0**, typecheck/lint 0 ; `1768`/`1769` `up/down/up`
  sur PG réel isolé, contraintes prouvées par rejet. **3 commits** (`ffbc4a1`,`e007664`,`8665e96`),
  **aucun merge**.
- **Ordre de merge requis** : `feat/catalog-refonte` (1759-1766) **→** `feat/product-sheet-erp-pa`
  (1768-1769). Dépendance prouvée (fichiers catalogue absents d'`origin/main`). Registre :
  `docs/MIGRATIONS_LEDGER.md`. ⚠️ `feat/catalog-refonte` **pas encore sur le remote** (à pousser en 1er).
- **Reste gated (Tier-2, GO nominatif)** : **P-C** (`product_promotions` + prix caisse) → dossier
  `GO_PC_PACKAGE.md` ; exécution migration sur base partagée ; merge `main`.
- **Vérif LIVE clic-à-clic : NON FAITE** — fiche produit ajoutée aux surfaces à parcourir
  (`docs/design/product-sheet-erp-live-verification.md`).

### Fiche produit ERP — P-D (périmètre réduit, 2026-07-17)
- ✅ **M-G vues serveur** (mig `1770`) : `user_saved_filters` + `/me/saved-filters` ; `ProductsPage`
  persiste côté serveur (repli local). ✅ **Stats réelles** : `GET /products/:id/stats` (ventes/CA/panier/
  marge/rang/série 12 s. depuis ventes complétées) + onglet Statistiques réécrit.
- Commits `ab5c6e5` (M-G), `cec3f53` (stats). BE **1091/0**, FE **84/0**, build OK. **Aucun merge.**
- ⏸️ **Scan multi-sources exclu** (D-FP3 = décision produit ouverte, gaté). Registre : 1770 = M-G.
- `feat/catalog-refonte` désormais **poussée** (`1fc932f`) — ordre de merge catalogue→ERP inchangé.
## Chantier Journal de stock unifié / NF525 — branche `feat/stock-journal-nf525-on-main`
> Surface Tier-2 (fiscal/stock). Synthèse : `PRODUCTS_FISCAL_STOCK_SYNTHESIS.md` · Dossier de GO :
> `GO_F2_PACKAGE.md` · Dette : **D22**. **Aucun merge (Tier-2, GO owner).**

**Véhicule canonique du GO : `feat/stock-journal-nf525-on-main`** — branchée sur `origin/main`,
**7 commits**, indépendante du catalogue (prouvé : intersection = 3 docs de suivi, aucun fichier de
code ; toutes les tables requises sur `origin/main`). Mergeable **seule**, sans embarquer la refonte
catalogue. ⚠️ **La branche empilée `feat/stock-journal-nf525` (stack de 40 commits catalogue) est
ARCHIVE** — ne plus l'utiliser comme véhicule de GO ni de merge.
> Écart pg-mem 1072 (stacked) → 967 (on-main) = **105 tests**, entièrement la différence de base :
> 104 tests dans 11 specs catalogue+accès + 1 test `csv-util` (Lot H). Aucun test manquant.

- **F0** — mig 1767 additive : liaison vente sur `stock_movements` + index + unique partiel. ZÉRO
  comportement. Base vierge : 40 migrations, **tête = 1767**. ✅
- **F1** — écriture double *shadow*, flag **OFF par défaut**. Vente+retour → mouvements. Hash inchangé. ✅
- **F1b** — `inventory_adjust` shadow, `quantity` = **delta signé** (convention ratifiée). ✅
- **F2** — void restitue les composants de pack (**correctif G3**, preuve rouge→vert jouée) +
  mouvements inverses `void`. Hash de la vente d'origine inchangé. ✅
- **Couverture caisse COMPLÈTE** : tous les chemins qui mutent le scalaire (vente/pack/retour/void/
  ajustement) écrivent le journal sous flag. Reste hors journal : système B legacy → F4.
- **Instrument exécutable** — `scripts/stock-reconcile.js` : CLI **lecture seule stricte**
  (`BEGIN TRANSACTION READ ONLY`), rapport par produit/magasin + Δgap, exit 0/2/1 vérifiés.
- **Runbook** — `STOCK_JOURNAL_ACTIVATION_RUNBOOK.md` : activation mécanique (variable, ordre
  local→sandbox→[prod interdite], surveillance, rollback, critère N motivé par le volume).
- **Vérifs (vrai PG, base jetable, exit 0)** — pg-mem **967/0** ; F0 **3/3** ; F1 **5/5** ;
  **F1b 4/4** ; **F2 5/5** ; réconciliation **4/4** ; non-régression fiscale (avoir 1/1, fiscal-e2e 1/1,
  packs 2/2, anti-survente 1/1).
- **En attente de DÉCISIONS owner (pas un « GO » — un choix)** — **F3** : (a) projection-cache vs
  bascule littérale, (b) cutover script vs migration, (c) N jours ; **F4** : Option A vs B. Dossiers
  prêts dans `GO_F2_PACKAGE.md`. **F3 est aussi bloqué physiquement** tant que le flag n'a pas tourné
  en double-run (journal vide → bascule = stock 0).
- **Gaté, GO nominatif** — **activation du flag hors test local**, **F3**, **F4**, **tout merge**.
- **Dette D22 (rétrécie)** — moitié « couverture » fermée par F1b+F2 (tous les chemins caisse
  journalisés). Reste : legacy système B → F4, et solde d'ouverture → cutover F3. D21 réservée
  à la branche accès non mergée.
