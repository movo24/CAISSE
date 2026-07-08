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
- [ ] **M601** POS : câbler branche succès TPE (ou bouton confirm) + test
- [ ] **M603** POS : inclure `creditNoteCode` dans l'enqueue offline + tests finalize
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
> (`useCart`/`usePayment`, récent, sain) et chemin **desktop inline** (`POSPage.tsx:505-826`,
> ancien, divergent). La cible produit V1 = **iPad** (CLAUDE.md, Apple strategy).

| # | Module | Statut | Réalité (preuve) |
|---|--------|--------|------------------|
| 1 | POS dashboard caisse | 🔄 | iPad prêt (scan, panier, qty, suppression, inconnu→demande, TTC centimes). **Desktop inline divergent** : remises affichées mais **non transmises** (`POSPage.tsx:736-740` n'envoie pas `toSaleDiscountFields`) |
| 2 | Sessions caisse (ouverture/fermeture) | ✅ (iPad) | Backend ✅ (γ invariant, comptage attendu/compté/écart, skip motivé, PR #18-#22). **Fond de caisse : UI POS livrée (PR #23)** — `CashOpenModal` à l'ouverture ; déclaration caissier une fois, correction manager/admin gated + auditée (migration 1752, `POST /pos-sessions/:id/opening-cash`), intégré à l'attendu, marqueur backoffice |
| 3 | Ventes | 🔄 | Backend ✅ (hash v2, idempotence, session binding). iPad OK. **`Idempotency-Key` maintenant posé sur la vente ONLINE (PR #24)** — clé stable par encaissement (`saleIdemKeyRef`), réutilisée sur double-clic / retry, portée dans l'enqueue offline pour dédup d'un create à réponse perdue (`syncEngine` préfère `payload.idempotencyKey`). ⚠️ Reste : **Desktop, sur échec de création, fabrique un faux ticket `T-######` et vide le panier** (`POSPage.tsx:743-745`) — traité en PR #26 |
| 4 | Paiements | ⚠️ | Espèces ✅ (rendu `paymentMachine`, tiroir iPad). **Carte : MOCK minuterie 25 s — `handleTpeResponse('success')` n'est appelé NULLE PART**, l'encaissement carte ne peut jamais aboutir (M601 confirmé). `useStripeTerminal` (WisePad 3) complet mais **orphelin** (0 consommateur) ; backend Stripe réel env-gated |
| 5 | Retours / remboursements | ✅ | Online + offline, motif obligatoire, idempotence, session-bound serveur, cash déduit de l'attendu (PR #22). Pas de capture TPE pour le remboursement carte (cohérent avec #4) |
| 6 | Stock | ✅/⚠️ | Décrément/restore atomiques dans les tx. Réconciliation ≥20 % complète (backend+UI+rôles). ⚠️ Alerte seuil AU MOMENT de la vente dormante (`sales.service.ts:632` SQL inline ne passe pas par `StockService.decrementStock`) — alertes par polling uniquement ; seuils absolus 10/5, pas de « règle 20 % » stock bas |
| 7 | Produits / SKU / variantes | ✅ | CRUD, anti-doublon EAN (index unique DB + 409), variantes complètes, création POS interdite serveur (PIN manager sinon 403, `product-integration.service.ts:247-271`) |
| 8 | Prix magasin | ✅ | `resolveEffectivePrice` réellement appelé dans le chemin de vente (`sales.service.ts:262`), historisé + audité |
| 9 | Scanner code-barres | 🔄 | Douchette = input focalisé + Enter (fragile si perte de focus, pas de debounce) ; le listener document dédié existe mais est **mort** (`startBarcodeListener` jamais appelé). Caméra ZXing réelle ; douchette BT réelle (iPad) |
| 10 | Imprimante ticket | ⚠️ | ESC/POS Bluetooth **réel mais monté iPad uniquement** (`IPadPOSLayout.tsx:99`). **Desktop : AUCUNE impression** — `window.electronAPI` jamais exposé (`preload.ts`), zéro handler ipcMain → chemin USB/Electron mort. Backend `printTicketMock` = console.log |
| 11 | Tiroir caisse | 🔄 | Kick RJ11 réel via imprimante BT (iPad, auto sur espèces). Desktop : mort (même cause que #10) |
| 12 | Rapports | 🔄 | X/Z/journalier/période/analytics/trend backend ✅ + ReportsPage. Onglet « Analytique » = placeholder (mais Performance page consomme analytics/trend). **PDF duplicata/avoir/Z implémentés mais INACCESSIBLES : `DocumentsModule` non importé dans `app.module.ts`** |
| 13 | Backoffice manager/admin | 🔄 | Sessions/écarts ✅, scores équipe+alertes ✅, produits/stock ✅, réconciliation ✅. **Pas de page Ventes** (list/détail/void backend sans UI). Filtres employé/terminal absents (colonnes seulement). Import CSV backend validé **sans UI**. Garde de rôle front = nav-hide (le serveur tient via `@Roles`) |
| 14 | Employés / droits | ✅/⚠️ | Serveur ✅ (PIN bcrypt, rotation refresh + anti-replay, lockout par IP, hiérarchie rôles, audit chaîné). ⚠️ **AUCUNE auth employé offline** (gate POS = appel serveur ; cache TW24 sans hash PIN par design) ; QR badge = TW24 online-only |
| 15 | TimeWin24 | 🔄 | Proxy réel : HMAC+Bearer, circuit breaker, push idempotent, stores/shifts feeds, fin de shift probante (PR #22). Défaut = **local-first** (`POS_AUTH_AUTHORITY='caisse'`). Dépend du service TW24 externe + env vars (sans elles : « disabled » cosmétique, appels vers localhost:3000) |
| 16 | Comptamax24 | ❌⛔ | **Zéro code** (grep exhaustif). Parqué par design : SaaS séparé consommant des exports/API — rien à auditer |
| 17 | Mobile inventaire | 🔄 | App réelle (scan ZXing, offline queue idb + syncEngine, auth PIN) mais 1 seul fichier de test. **Doc drift : CLAUDE.md l'étiquette « Wesley Club loyalty »** — la vraie app fidélité est `customer-app` (⛔ build sur simple `npm install`, 0 test). « Pay24 Max » / « Analytik R » : n'existent nulle part dans le repo |
| 18 | Déploiement Railway/Vercel | ⛔ | Railway : **déploiement manuel obligatoire** (webhook impossible) + token owner. **DNS `api.addxintelligence.com` NON cut-over alors que les 3 `vercel.json` réécrivent `/api/*` vers ce domaine** ; ancien CNAME = service mort → pas de rollback. Vercel sert la **PWA** du POS (pas le .exe). `.exe` **non signé**, **pas d'auto-update**. Seed dev-only ; onboarding catalogue réel = import CSV… sans UI |
| 19 | Tests / CI | 🔄 | Backend ✅ 104 specs (878 verts, pg-mem, fiscal/session/cash/e2e-money). **CI n'exécute QUE le backend** : vitest pos-desktop (23 fichiers) + backoffice (6 fichiers/36 cas — la doc disait « 12 ») hors CI ; 3 specs pg réels jamais exécutés (pas de `TEST_DATABASE_URL`) ; 1 e2e Playwright smoke (login→scan→cash) **hors CI** ; **0 test périphérique** ; scénario magasin complet = segments disjoints, impression jamais couverte |
| 20 | Risques terrain | — | Voir top 10 ci-dessous |

### Pourcentage réaliste d'avancement POS complet
- Backend métier (ventes/fiscal/sessions/score/retours/stock) : **~90 %**
- POS chemin iPad (cible V1) : **~75 %** (manquent : carte réelle, fond de caisse UI, auth offline)
- POS chemin desktop : **~50 %** (divergent, 3 défauts sérieux)
- Matériel : **~55 %** (BT iPad réel ; Electron/USB mort ; 0 test)
- Backoffice : **~75 %** · Intégrations : **~40 %** · Déploiement : **~40 %** (owner-gated)
- **Global « prêt magasin » : ~60 %** — un magasin iPad + espèces + imprimante BT peut fonctionner aujourd'hui ; carte, fond de caisse, offline-auth et distribution le bloquent pour un usage réel complet.

### TOP 10 blocages avant mise en magasin (ordre de gravité)
1. **P0 — Paiement carte impossible** : mock minuterie, `useStripeTerminal` orphelin. Un magasin ne peut pas encaisser en carte. (Câblage WisePad 3 dans `usePayment` = chantier dédié.)
2. **P0 — Desktop : faux succès sur échec de vente** (`POSPage.tsx:743-745`) — ticket fabriqué, panier vidé, zéro trace serveur. Intégrité fiscale. Décision produit : aligner desktop sur les hooks OU neutraliser le chemin desktop (cible V1 = iPad).
3. **P0 — Desktop : remises non transmises** (même racine que #2 — divergence des 2 chemins).
4. **P0 — Aucune impression ticket sur desktop** (`electronAPI` jamais exposé) — si la cible reste iPad+BT, à documenter ; sinon à câbler.
5. ~~**P0/P1 — Fond de caisse sans UI POS**~~ ✅ **RÉSOLU (PR #23)** : `CashOpenModal` à l'ouverture ; déclaration caissier une fois puis immuable ; correction manager/admin gated + auditée (`setOpeningCash`, migration 1752) ; intégré à l'attendu ; marqueur backoffice.
6. **P1 — Aucune auth employé offline** : coupure internet = impossible de déverrouiller la caisse (le gate appelle le serveur ; cache TW24 sans hash PIN).
7. **⛔ P1 — DNS non cut-over + déploiement Railway manuel** : les fronts déployés pointent vers un domaine inactif ; pas de rollback. GO owner requis.
8. ~~**P1 — Pas d'`Idempotency-Key` sur la vente online**~~ ✅ **RÉSOLU (PR #24)** : clé client stable par encaissement (`newIdempotencyKey` + `saleIdemKeyRef`), envoyée en en-tête `Idempotency-Key` sur les deux chemins (hooks iPad + desktop inline), réinitialisée après confirmation, et **portée dans l'enqueue offline** pour qu'un create à réponse perdue soit dédupliqué et non dupliqué. Backend `createSale` déjà idempotent (fast-path replay + recheck in-tx + clé persistée, expiry 7 j). Tests : `sale-idempotency.spec.ts` (backend pg-mem : même clé → 1 vente + ticket rejoué ; clés distinctes → ventes distinctes), `idempotency.test.ts` (pos-desktop : unicité/format + invariants de câblage source).
9. **P1 — Onboarding catalogue magasin** : seed dev-only, import CSV backend validé **sans UI** — aucun chemin outillé pour charger le catalogue d'un vrai magasin.
10. **P1 — Couverture CI incomplète** : tests front/e2e/périphériques hors CI, PDF documents non branchés (`DocumentsModule`), page Ventes backoffice absente.

### Prochaine PR recommandée
**PR #24 — Idempotency-Key vente online** ✅ **LIVRÉ** (clé client stable, deux chemins, offline-carry, tests backend + pos-desktop). Suite de la roadmap terrain (ordre imposé owner) :
- **PR #25 — Paiement carte réel / WisePad 3** : câbler `useStripeTerminal` dans `usePayment` ; mock strictement dev/test ; en prod, si Stripe Terminal/WisePad 3 non configuré → bouton carte désactivé ou erreur claire, jamais de paiement carte fictif validant une vente réelle.
- **PR #26 — Neutraliser/aligner le chemin desktop inline** : supprimer le faux ticket sur échec (`POSPage.tsx:743-745`), aligner sur le pipeline sécurisé ou verrouiller le chemin (cible V1 = iPad).
- **PR #27** impression ticket terrain · **PR #28** auth employé offline V1 · **PR #29** produit inconnu/onboarding catalogue · **PR #30** page Ventes/rapports manager.

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

## Prochaine action automatique (continuité)
Exécution autonome sur le safe restant (audit read-only des ⚠️, garde-fous additifs, tests, docs). Vrais blocages ci-dessus uniquement.
