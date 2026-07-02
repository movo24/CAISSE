# STATE_INDEX — État réel du logiciel CAISSE (audit vérifié 2026-07-01)

> Règle : rien d'inventé. « absent aujourd'hui » = pas de code. « mock/simulation » = code présent mais pas d'envoi réel. « gated » = dépend d'un secret/clé/DB/runtime. Preuves par fichier/route/test/commande.
> Chiffres backend vérifiés (re-comptés P331, 2026-07-02) : **45 modules · 43 controllers · 236 routes · 48 entités · 24 migrations · 212 fichiers de specs (209 suites PASS/3 .pg skip · 1378 tests PASS/5 skip)** (re-compté P331). Front : **26 pages back-office · 26 objets API · 29 routes** (comptage P246). Note : le module `fiscal` est volontairement hors `app.module` (outillage CLI `npm run fiscal:verify`) ; `documents` est câblé via `receipts.module`.

---

## 1. Pourcentage de finition (estimation honnête)

> % = maturité du CODE (construit + testé localement). La colonne « live end-to-end » tient compte des gates externes non franchies.

| Couche | Construit+testé | Live end-to-end | Note |
|---|---|---|---|
| **Backend (logique métier)** | ~85 % | ~70 % | 44 modules, 1128 tests, tsc/build verts. Runtime DB de certains endpoints non re-validé sans Postgres. |
| **Frontend back-office** | ~80 % | ~75 % | 26 pages routées, tsc+vite build verts, vitest. |
| **POS desktop (Electron)** | ~75 % | ~65 % | Offline-first réel, appelle `/api`, tsc+build verts ; e2e Playwright non lancé. |
| **API interne (front↔back)** | ~85 % | ~80 % | 26 clients API consommés par les écrans. Quelques endpoints non consommés. |
| **Base de données** | ~90 % (schéma) | ~70 % | 47 entités, 21 migrations. Migration 1725 (outbox) **non jouée sur cible** (gated). |
| **Sécurité** | ~90 % | ~90 % | Auth JWT+PIN, tenant isolation, gardes secrets/env/CSV/XSS testés. |
| **Tests** | ~75 % | — | 1128 backend + 46 front. Manque : e2e, runtime DB, `.pg` (2 skip). |
| **Intégrations internes (Comptamax/TimeWin/outbox)** | ~70 % | ~40 % | Exports CSV réels+testés ; relais HTTP = **simulation** (gated) ; social = justificatif (gated). |
| **Sources externes (météo/transport)** | ~50 % | ~15 % | Connecteurs axios présents, **gated par clé** → retournent neutre sans clé. |
| **Analytik R** | ~30 % | ~5 % | **Prep seulement** : outbox + API pull + simulation. Aucun consommateur/lien live. |
| **Workers / jobs** | ~70 % | ~40 % | Cron relais (simulation OFF par défaut), shift-reminders, airtable-sync — gated. |
| **Dashboards** | ~80 % | ~75 % | Dashboard, Performance, Supervision, Réseau — réels. |
| **Exports PDF/CSV/HTML** | ~75 % | ~70 % | CSV (compta/écart/amplitude) réels+testés ; reçu **HTML** réel ; **PDF = absent** (reçus en HTML, pas PDF). |
| **Mobile (Wesley Club)** | ~55 % | ~40 % | 27 fichiers, structure réelle ; runtime non validé. |
| **Customer-app** | ~35 % | — | 11 fichiers, plus mince. |

**% GLOBAL estimé : ~72 % construit / ~55 % exploitable end-to-end.**
Écart = les 3 gates externes (relais, migration cible, social) + clés API externes + runtime DB/e2e non franchis (volontairement).

### Répartition par état
- **Fait & testé** : cœur POS (ventes, NF525, remises, retours, stock, Z-report, loyalty, coupons), exports CSV compta, gardes sécurité, écart d'inventaire, supervision, auth.
- **Fait mais pas branché en live** : relais outbox (simulation), écritures sociales (justificatif), migration 1725 (prouvée pg-mem, pas jouée cible).
- **Mock/simulation seulement** : `SimulationOutboxPublisher` (envoi Comptamax/TimeWin/Analytik R), connecteurs externes sans clé (retour neutre).
- **Prévu pas commencé** : consommateur Analytik R réel, reçus **PDF**, e2e Playwright.
- **Bloqué par secret/clé/runtime** : OUTBOX (URL+secret), migration (DATABASE_URL cible), social (décision compta), météo/transport (clés), PIN-login-500 (#1, runtime).

---

## 2. Index des modules backend (45)

Légende : ✅ prêt+testé · 🟡 partiel/gated · ⚠️ à vérifier runtime · 🔴 absent

| Module | Statut | Routes/rôle | Tests | Risque restant |
|---|---|---|---|---|
| auth | ✅ | login PIN/QR/email, JWT, refresh | auth-security | #1 PIN 500 à re-tester runtime |
| mobile-auth | ✅ | JWT Wesley Club (aud mobile-app) | mobile-tokens (5) | — |
| sales | ✅ | flux vente, hash-chain, idempotence | sale-transaction, money | runtime DB à valider |
| returns | ✅ | avoirs/retours, NF525 | avoir-m1-m3, returns-policy | — |
| products | ✅ | CRUD, EAN, prix override | ean, product | — |
| stock | ✅ | decrement, adjust, alertes, **variance** | stock, stock-variance | — |
| stock-locations / inventory-scan | ✅/🟡 | quantités, scan inventaire | oui | runtime |
| promotions | ✅ | buy_x, %, first, usage-cap | promo | — |
| coupon / loyalty-card / loyalty-admin / jackpot | ✅ | QR, redemption, idempotence | oui | — |
| customers / customer-visits | ✅ | QR loyalty, OTP, fréquence | oui | — |
| employees | ✅ | CRUD, QR badge, PIN policy | oui | — |
| stores / organizations / units | ✅ | hiérarchie, TW24 sync | oui | **Magasins=0 si TW24 sync KO** |
| reports | ✅ | Z-report, sales-trend (J-1/S-1), perf | report | — |
| sales-ai | 🟡 | pricing, forecast, **external-context (météo/transport)** | oui | gated clés API |
| sales-guards | ✅ | garde-fous pré-vente | oui | — |
| currency | ✅ | FX, convertMinor | currency, money-precision | — |
| audit | ✅ | hash-chain append-only | audit | — |
| receipts | ✅ | reçu HTML public (UUID), email JWT | receipts.controller (XSS lock) | PDF absent |
| comptamax | 🟡 | journal/cash-control/social **CSV export** | cash-control, pre-accounting, social-entries-guard | envoi réel = gated |
| integration | 🟡 | outbox events/shifts/stock-signals/relay | outbox-publisher(8), keyset, reconciliation | **relais=simulation**, migration 1725 gated |
| pos-session | ✅ | ouverture/fermeture, invariant DB | pos-session-* | — |
| timewin | 🟡 | client HTTP réel (HMAC, circuit breaker) | timewin | gated URL/clé, live non testé |
| stripe-terminal / terminals | 🟡 | idempotence paiement | stripe | paiement réel interdit/non testé |
| notifications / shift-reminders | 🟡 | QR reminders, cron pré-shift | oui | providers gated |
| occupancy | 🟡 | webhook Radar (RADAR_API_KEY) | — | gated clé |
| airtable-ops | 🟡 | sync produits (mapper risk high) | airtable-mapper (8) | gated clé Airtable |
| connected-apps | 🟡 | CRUD apps tierces | — | pas de spec colocated (CRUD) |
| mobile-cockpit | ✅ | `GET /mobile/v1/alerts` (read-only) | shaper 6/6 | runtime |
| pos-integration / subscriptions / documents / fiscal / backoffice-discounts / health | ✅/🟡 | divers | partiel | fiscal-verify OK ; health 503 |
| sync | ✅ | push/pull offline, conflit, rejet sans id | conflict | — |

Preuve routes : `grep @Get/@Post *.controller.ts` = 230 (P282). Preuve tests : `jest --listTests` = 197 fichiers (P282).

---

## 3. Connexion API interne (front ↔ back)

- **Connecté** : oui. Back-office (`services/api.ts`) expose **26 objets** (`authApi…healthApi`) tous consommés par les 26 pages ; audits P150/P200 = **0 page orpheline, 0 appel API absent**. POS-desktop appelle `/api` (auth refresh, health, sync).
- **Écrans consommant réellement des endpoints** : Dashboard, Products, Sales/Returns, StockAlerts, ProductPerformance (sales-trend), Reports, Employees, Payroll, Accounting (comptamax journal/cash-control), IntegrationSupervision (outbox/shifts/stock-signals/health/relay), InventoryVariance (stock/variance + adjust), SalesGuards, ConnectedApps, AirtableOps, Organizations/Units/Stores, Settings, Billing, Login.
- **Endpoints exposés mais peu/pas consommés côté back-office** : `/comptamax/social` (export social, consommable ; pas d'écran dédié), certaines routes `/integration/events` (destinées à Analytik R, pas au front). → « exposés pour consommateur externe », pas un défaut.
- **Endpoints manquants** : reçu **PDF** (seul HTML existe) ; pas d'endpoint « push Comptamax » réel (par design = relais outbox).
- **Auth/JWT/permissions** : `JwtAuthGuard` + `RolesGuard` (admin>manager>cashier) + `TenantInterceptor` global (storeId du JWT). **Public volontaire** : `GET receipts/:saleId(/html)` (capability-URL UUID), `health`, endpoints `@SkipTenantCheck` documentés. Email reçu = JWT. Anti-IDOR : storeId dérivé du JWT (P124/P132).

Preuve : `services/api.ts` (26 exports), `main.tsx` (29 routes), `receipts.controller.ts` (@SkipTenantCheck lignes 60/109, JWT ligne 122).

---

## 4. Sources externes (vérifié concrètement)

| Source | Connecteur présent | Client/endpoint | Clé requise | Récupérable aujourd'hui | Tests/mock | Reste à faire |
|---|---|---|---|---|---|---|
| **Météo (OpenWeather)** | ✅ `sales-ai/external-context.service.ts` (axios) | `getFullContext` → `GET sales-ai/external-context` | `OPENWEATHER_API_KEY` (ou GOOGLE_MAPS pour geocode) | **Non sans clé** → retourne neutre (fail-safe) | `weather-impact.ts` testé | fournir la clé |
| **Transport (PRIM — Île-de-France Mobilités)** | ✅ même service (axios) | idem | `PRIM_API_KEY` | **Non sans clé** → neutre | — | fournir la clé PRIM |
| **Géocodage (Google Maps)** | 🟡 fallback météo | idem | `GOOGLE_MAPS_API_KEY` | non sans clé | — | clé |
| **Occupancy (Radar)** | ✅ `occupancy.controller.ts` (webhook entrant) | `POST occupancy/...` (auth RADAR_API_KEY) | `RADAR_API_KEY` | non sans clé | — | clé |
| **Météo-France (spécifique)** | 🔴 **absent aujourd'hui** | — | — | non | — | choisir OpenWeather (présent) ou ajouter un client Météo-France |
| **France Mobilités (national)** | 🔴 **absent** ; PRIM (IDFM régional) présent | — | — | non | — | ajouter un client si besoin national |
| **Jours fériés / calendrier / événements / trafic** | 🔴 **absent aujourd'hui** | — | — | non | — | à créer si requis (temporal-pattern existe côté ventes, pas de source jours fériés) |

**Résumé honnête** : le logiciel *sait* récupérer météo + transport IDFM (code axios réel, fail-safe), mais **rien n'est récupéré aujourd'hui** faute de clés (retour neutre). Météo-France, France Mobilités national, jours fériés, trafic = **absents**.

---

## 5. Analytik R / AnalyticsR — statut réel

**Statut global : PRÉPARÉ (prep), PAS connecté live.** Aucun lien direct, aucune base partagée, aucun webhook actif.

- **POS Caisse ↔ Analytik R** : 🟡 prep. Le POS écrit des events dans l'**outbox transactionnel** (`integration_events`, migration 1725 **non jouée cible**) et expose une **API pull read-only** pour Analytik R : `GET /integration/events` (keyset cursor), `/shifts`, `/stock-signals`, `/reconciliation`, `/outbox/stats`. Relais push = `SimulationOutboxPublisher` (aucun envoi réel). **Preuve** : `outbox-publisher.ts:67` (simulation par défaut), `integration.controller.ts` (routes).
- **TimeWin24 ↔ Analytik R** : 🟡 prep indirect — amplitude de poste (`shift-amplitude.ts`) exposée via `/integration/shifts` (consommable par Analytik R). Pas de lien direct TW24→Analytik R.
- **Comptamax24 ↔ Analytik R** : 🔴 aucun lien. (Comptamax produit des CSV compta, séparés d'Analytik R.)
- **Mécanisme** : transactional outbox (events) + API pull HTTP + relais push (simulation). Pas de queue externe, pas de base partagée, pas de webhook live.
- **Schéma des données échangées** : `integration-event.entity.ts` (17 colonnes : id, type, aggregate*, storeId, organizationId, terminalId, employeeId, occurredAt, payload jsonb, schemaVersion, source, status, publishedAt, attempts, createdAt). Enveloppe signée : `publish-request.ts` (HMAC).
- **Ce qui manque pour le live** : jouer migration 1725 (base) + fournir OUTBOX_PUBLISH_URL/SECRET (relais) OU brancher un consommateur Analytik R sur l'API pull. Le consommateur Analytik R lui-même = **absent de ce repo** (autre produit).

---

## 6. Carte des connexions (ce qui communique VRAIMENT)

```
                         ┌───────────────────────────── back-office (React/Vite) ──────────────────────────┐
                         │  Dashboard · Products · Sales · Accounting · Supervision · Inventory · Reports…   │
                         └───────────────▲──────────────────────────────────────────────────────────────────┘
                                         │ HTTP /api (JWT, 26 clients API)  ✅ CONNECTÉ
   POS Desktop (Electron, offline-first) │
     ─ /api/auth /api/health /api/sync ──┤
                                         ▼
                         ┌──────────────────────────── BACKEND NestJS (44 modules) ─────────────────────────┐
                         │  auth · sales(NF525) · stock · returns · reports · comptamax · integration · …    │
                         │        │                    │                     │                               │
                         │  PostgreSQL (Neon)     Redis (optionnel)     Outbox (integration_events)          │
                         └───────┬──────────────────────┬───────────────────────┬───────────────────────────┘
      TimeWin24 (HR)  ◀── HTTP réel (HMAC pos-feed,     │                        │
      source of truth     circuit breaker) 🟡 gated     │                        │ push = SIMULATION 🟡 (gated)
                                                        │                        ▼
      Comptamax24  ◀── exports CSV LOCAUX 🟡            │        Analytik R  ◀── API pull /integration/* (prep) 🟡
      (journal/cash/social ; PUSH réel = gated)         │                    ◀── relais HTTP (simulation, gated)
                                                        │
      Météo OpenWeather / Transport PRIM  ◀── axios 🟡 gated clé (retour neutre)
      Radar (occupancy)  ◀── webhook entrant 🟡 gated clé
      Airtable  ◀── sync produits 🟡 gated clé
                                                        │
      Exports : CSV (compta/écart/amplitude) ✅  ·  Reçu HTML ✅  ·  PDF 🔴 absent
      Workers/jobs : cron relais (OFF défaut) · shift-reminders · airtable-sync  🟡 gated
      Mobile Wesley Club 🟡 (JWT mobile-auth) · Customer-app 🟡
```

**Communiquent réellement aujourd'hui** : front ↔ backend (✅), POS-desktop ↔ backend (✅), backend ↔ PostgreSQL (✅ en local/prod A). **Gated/simulation** : TimeWin24 (client réel mais gated), Comptamax24 (CSV local ; push gated), Analytik R (pull prep + relais simulation), externes météo/transport/radar/airtable (clés).

---

## 7. Preuves (échantillon)
- Modules/routes : `ls src/modules` = 44 ; `grep @Get/@Post` = 230 ; `find *.controller.ts` = 42. (re-compté P282)
- Tests : `jest --listTests` = 139 fichiers ; agrégat `167 suites PASS/2 skip, 1128 tests PASS/3 skip` (P244).
- Relais simulation : `outbox-publisher.ts:61-67` (`createOutboxPublisher` → `SimulationOutboxPublisher` sans URL+secret) ; loopback prouvé `outbox-publisher.spec.ts` 8 tests (P171/P206).
- Migration outbox non jouée : `1725000000000-AddIntegrationOutbox.ts` ; dry-run pg-mem `migration-1725-dryrun.spec.ts` 3 tests (P207) ; **pas** joué sur cible.
- Externe météo/transport : `sales-ai/external-context.service.ts:66,114` (clé requise, `return neutral` sinon).
- TimeWin réel : `timewin.service.ts:131-206` (fetch `/api/health`, `/api/pos-feed/*`, HMAC).
- Comptamax export : `comptamax.service.ts` (`journalToCsv`, `cashControlToCsv`, `workforceToCsv`) — local, pas de push.
- Front connecté : `services/api.ts` (26 exports), audits 0 orphelin (P150/P200).
- Sécurité : `test:security` 10 suites/34 tests (P238) ; XSS receipts lock (P241).

---

## 8. Verdict honnête

**Solide (fait + testé)** : cœur POS/NF525 (ventes, retours, hash-chain, idempotence), stock + écart d'inventaire, remises (caisse+back-office+offline), loyalty/coupons, exports CSV compta, auth/permissions/tenant, gardes sécurité (secrets/env/CSV/XSS), supervision & interfaces siège, POS-desktop offline. Backend 1128 tests verts, front 46 + builds verts, CI complète.

**Fragile / à re-vérifier** : runtime DB de certains endpoints (sans Postgres ici), PIN-login-500 (#1) non re-testé, TimeWin24 live non testé, e2e Playwright non lancés, mobile/customer-app runtime.

**Seulement maquetté / simulation** : relais outbox (SimulationOutboxPublisher), écritures sociales (justificatif RH, pas d'écritures), connecteurs externes sans clé (météo/transport/radar/airtable → neutre), consommateur Analytik R (absent du repo).

**Manque pour une version exploitable end-to-end** : (a) jouer migration 1725 sur la base cible ; (b) fournir OUTBOX_PUBLISH_URL+SECRET pour l'envoi réel ; (c) valider le plan de comptes social ; (d) fournir les clés externes (OpenWeather/PRIM/Radar/Airtable) si ces signaux sont voulus ; (e) reçus PDF (si requis) ; (f) e2e + runtime DB de recette.

### 10 prochains blocs prioritaires (ordre) — statut au 2026-07-02 (P272)
1. ⛔ **Runtime local de recette** : backend + Postgres jetable, migration:run 1725, smoke-test endpoints clés (lève #1 PIN-500). *(gated DB — hors sandbox)*
2. ⛔ **Relais outbox réel** contre un receveur de recette (OUTBOX_PUBLISH_URL+SECRET de test) → prouver `published` croît. *(gated secret)*
3. 🟡 **e2e Playwright** : scaffold + CI `--list` FAIT (P251) ; le RUN reste gated (chromium + backend seedé).
4. ✅ **Reçu PDF** — FAIT (P248) : `GET /api/receipts/:saleId/pdf`, valeurs figées verbatim, testé.
5. ✅ **Consommateur Analytik R (contrat)** — FAIT (P249) : `consumer-contract.ts` + ReferenceConsumer idempotent + garde de synchro, 15 tests.
6. ⛔ **Clés externes météo/transport** en recette → prouver récupération réelle + fallback. *(gated clé)*
7. ⛔ **TimeWin24 live** : test d'intégration contre un TW24 de recette (health + pos-feed) + circuit breaker. *(gated accès)*
8. ⛔ **Écritures sociales** : après validation comptable, brancher derrière `canPostSocialEntries`. *(gated décision)*
9. ✅ **Couverture des CRUD non testés** — FAIT (P247) : connected-apps + terminals, 18 tests DI.
10. 🟡 **Durcissement mobile/customer-app** : tests + ErrorBoundary FAITS (P250) ; build natif Capacitor gated (paquets non installés).

> Re-preuve globale P272 (2026-07-02) : suite backend complète rejouée bout-en-bout — **188 suites PASS/2 skip, 1274 tests PASS/3 skip, 0 échec** ; front 14 fichiers/59 tests PASS ; tsc EXIT 0 ; nest build RC 0. Git réparé (refs inscriptibles), historique P271 restauré du bundle.
