# INTEGRATION_MATRIX — Toutes les connexions POS CAISSE

> Audit 2026-07-10, `main` @ `6238350`. Lecture seule, aucune mutation, aucun workflow déclenché.
> Statuts : ✅ VALIDÉ · 🟢 FONCTIONNEL · 🟠 PARTIEL · 🔴 CASSÉ · ⚫ ABSENT · 🕓 PRÉVU (câblé, dormant/non tiré).
> Constats critiques contre-vérifiés manuellement (weather 404, sync TW24 destructif, throttler mémoire).

## Vue synthétique

| # | Source → Destination | Protocole / endpoint | Auth | Statut |
|---|---|---|---|---|
| 1 | POS desktop → backend | HTTPS `https://api.addxintelligence.com/api` (absolu) | JWT Bearer + refresh | 🟠 |
| 2 | Backoffice → backend | HTTPS relatif `/api` (rewrite Vercel same-origin) | JWT Bearer + refresh | 🟢 |
| 3 | Mobile staff → backend | HTTPS absolu `/api` | JWT Bearer + refresh | 🟠 |
| 4 | Customer-app → backend | HTTPS absolu `/api/mobile` | JWT `aud:mobile-app` + refresh | 🟢 |
| 5 | Backend → PostgreSQL (Neon) | TypeORM/`pg`, `DATABASE_URL` sslmode=require | URL | ✅ |
| 6 | Backend → Redis (cache) | ioredis, `REDIS_URL` | URL | 🟢 (fallback mémoire) |
| 7 | Backend → Redis (realtime SSE) | ioredis pub/sub | URL | 🟢 (fallback in-process) |
| 8 | Backend → Redis (throttler) | — | — | 🔴 (annoncé Redis, réellement mémoire) |
| 9 | Backend → Redis (occupancy) | — | — | ⚫ (Map mémoire pure) |
| 10 | Backend → Stripe (SDK) | Stripe SDK, `STRIPE_SECRET_KEY` | clé | ✅ (null si absente, jamais mock) |
| 11 | POS → backend → Stripe Terminal (WisePad 3) | connection-token + `@stripe/terminal-js` | JWT + token Stripe | ✅ (réel ; sim gated dev) |
| 12 | Capture carte (vérif serveur) | `paymentIntents.retrieve` | — | ✅ (9 specs) |
| 13 | Stripe → backend (webhook billing) | `POST /api/subscriptions/webhook` | signature HMAC | ✅ (billing seul, hors caisse) |
| 14 | Refund carte → Stripe | — | — | ⚫ (avoir enregistré, aucun `refunds.create`) |
| 15 | GitHub Actions → Railway (deploy) | GraphQL `serviceInstanceDeployV2` | `RAILWAY_TOKEN` (Project/Bearer) | 🟠 (exécuté non prouvé sur disque) |
| 16 | GitHub Actions → Railway → IONOS (cutover) | workflow verify/migrate | Railway + IONOS `X-API-Key` | 🟠 (verify bloqué (e) clé IONOS) |
| 17 | Railway ↔ IONOS DNS (état actuel) | api CNAME | `X-API-Key` | 🕓 (cutover non exécuté, ancien backend vivant) |
| 18 | POS Caisse ↔ TimeWin24 (auth login) | `POST /api/auth/employee-login` | Bearer `TIMEWIN24_API_KEY` | 🟠 (local-first ; TW24 secours) |
| 19 | POS Caisse ↔ TW24 (store sync) | `/api/pos-feed/stores` | HMAC ou Bearer | 🔴 (destructif si liste vide, non testé) |
| 20 | POS Caisse ↔ TW24 (employés) | `/api/pos-feed/employees` | HMAC ou Bearer | 🟠 (cache mémoire, pas d'import DB) |
| 21 | POS Caisse ↔ TW24 (shift reminders/fin-shift) | `/api/pos-feed/today-shifts` | HMAC ou Bearer | 🟢 (testé, off par défaut) |
| 22 | POS Caisse ↔ Comptamax24 | — | — | ⚫ (zéro code — prévu par doctrine) |
| 23 | POS Caisse ↔ Analytik R | — | — | ⚫ (zéro code) |
| 24 | Backend → Airtable | REST `api.airtable.com/v0` | Bearer `AIRTABLE_API_KEY` | 🕓 (réel mais off par défaut) |
| 25 | Backend → SendGrid/SMTP (reçus) | REST/SMTP | clé/SMTP | 🟢 (no-op si non configuré) |
| 26 | Backend → SMS (notifications) | — | — | ⚫ (log-only, prévu) |
| 27 | Backend → Slack/Discord (alertes) | webhook `ALERT_WEBHOOK_URL` | URL | 🟢 |
| 28 | connected-apps (registre tiers) | CRUD DB | — | ⚫ (coquille sans moteur d'émission) |
| 29 | Desktop Electron IPC (main↔renderer) | contextBridge | — | ✅ (printing + customer-display) |
| 30 | Desktop → imprimante OS/BT | webContents.print / GATT ESC-POS | — | 🟢 (honnête, `no_printer` si absent) |
| 31 | Desktop → tiroir-caisse | — | — | ⚫ desktop / 🟢 BT iPad |
| 32 | Desktop → douchette wedge clavier | — | — | 🔴 (code mort, jamais branché) |
| 33 | Desktop offline sync → backend | file localStorage + `Idempotency-Key` | JWT | 🟢 (HMAC device non câblé, conflits stub) |
| 34 | Desktop build/update | electron-builder | — | ⚫ (non signé, pas d'auto-update) |

## Détail par connexion (source, endpoint, auth, données, réel, test, preuve, statut)

### 1. POS desktop → backend — 🟠 PARTIEL
- Endpoint : axios baseURL `https://api.addxintelligence.com/api` (absolu si non-localhost), timeout 15 s. Preuve : `pos-desktop/src/renderer/utils/apiConfig.ts:10-26`, `services/api.ts`.
- Auth : `Authorization: Bearer`, pré-check expiry + retry 401, file d'attente. Preuve : `api.ts:29-135`.
- Données : ventes, sessions, scan produit, catégories, loyalty, occupancy, sales-guards.
- Réserve : baseURL absolue cross-origin (dépend de CORS) ; le défaut prod pointe le CNAME encore non basculé.

### 2. Backoffice → backend — 🟢 FONCTIONNEL
- baseURL relative `''`→`/api`, rewrite Vercel same-origin → **immunisé CORS**. Preuve : `backoffice-web/src/services/api.ts:4`, `vercel.json:8`.
- Auth : idem (Bearer + refresh robuste). Le seul client sans risque CORS.

### 5. Backend → PostgreSQL — ✅ VALIDÉ
- `TypeOrmModule.forRoot({ type:'postgres', url: DATABASE_URL, pool max 30, connTimeout 5s })`, `synchronize=false` (piloté `TYPEORM_SYNCHRONIZE`), `migrationsRun=isProd`, fail-fast si synchronize+prod. Health `SELECT 1` timeout 5 s → 503 si down. Preuve : `app.module.ts:69-87`, `main.ts:167-170`, `health.controller.ts:47-60`.
- Réserves : pas de retry/backoff explicite (défauts TypeORM), SSL non forcé côté app (repose sur `sslmode=require` dans l'URL).

### 8. Throttler → Redis — 🔴 CASSÉ (trompeur)
- `ThrottlerModule.forRoot([...])` **sans `storage`** → MemoryStorage par pod. `main.ts:171-172,179` et `.env.example:29` prétendent « rate-limit partagé via Redis » — **faux**. Contre-vérifié : `app.module.ts:90` (forRoot, aucun storage). Non multi-instance-safe.

### 11-12. WisePad 3 / capture carte — ✅ VALIDÉ
- POS : `connection-token` (`POST /stripe-terminal/connection-token`) → SDK `@stripe/terminal-js` → `discoverReaders`/`connectReader`/`processPayment` réel ; `simulated:!PROD` gated. Preuve : `useStripeTerminal.ts:138-307`.
- Capture : POS transmet un vrai `paymentIntentId` → backend `paymentIntents.retrieve` exige `status==='succeeded'` + storeId + montant ≥ déclaré, sinon refus/`payment_pending`. Preuve : `sales.service.ts:161-218`, spec `card-capture-verify.spec.ts` (9 cas).

### 16. GitHub Actions → Railway → IONOS (cutover) — 🟠 bloqué (e)
- verify (lecture seule) : (a) `RAILWAY_TOKEN_OLD`==sweet-blessing/prod, (b) `RAILWAY_TOKEN`==caisse-backend/prod, (c) domaine sur 1 service OLD, (d) nouveau backend 200 → **tous verts** ; (e) IONOS → **`Invalid API key format`** (valeur de clé, pas le code — parsing durci en PR #44). migrate gaté Environment `production-dns-cutover`, jamais exécuté. Preuve : run 29088511278, `railway-dns-cutover.yml:116-136`. **Correction clé par l'owner en attente — ne rien relancer.**

### 18. TW24 auth login — 🟠 (doctrine inversée)
- Défaut `POS_AUTH_AUTHORITY=caisse` → **DB locale d'abord**, TW24 seulement si compte introuvable. Mauvais PIN sur compte existant = échec dur. Preuve + tests : `auth.service.ts:127-171`, `auth.service.spec.ts:86-173`. « TW24 source de vérité » n'est vrai ni pour le login ni pour la persistance (aucun import TW24→`employees`).

### 19. TW24 store sync — 🔴 destructif, non testé
- `POST /api/stores/sync` → `fetchStores()` → **désactive TOUS les magasins locaux actifs absents de la liste TW24**. Contre-vérifié : `stores.service.ts:390-399`. Si TW24 répond `200 {stores:[]}` (mauvais tenant / périmètre vide), **tout le réseau local est éteint**. Aucun garde-fou « refuser si 0 ». Aucun test (le spec mocke des méthodes inexistantes).

### 22-23. Comptamax24 / Analytik R — ⚫ ABSENT
- Grep exhaustif : zéro code `.ts`, zéro env, zéro route. Comptamax24 = doctrine « SaaS séparé consommant via API/events/exports » sans mécanisme d'export réel aujourd'hui. Preuve : `PROJECT_STATUS.md:120-121`, `.claude/skills/information/SKILL.md:31`.

### 32. Douchette wedge clavier — 🔴 code mort
- `startBarcodeListener()`/`startKeyboardWedgeListener()` définis mais **aucun appelant** → une douchette USB-HID globale n'est jamais captée (seuls les `<input>` focalisés + caméra fonctionnent). Preuve : `peripheralBridge.ts:462-501`.

### 33. Offline sync → backend — 🟢 (2 dettes assumées)
- File localStorage persistée, ping `HEAD /api/health` 15 s, `Idempotency-Key` stable posé avant l'appel. HMAC device `signSyncRequest` **jamais posé en header** (retourne null) → auth = JWT employé seul. `checkForConflicts` = stub `{hasConflict:false}`. Preuve : `syncEngine.ts:100-149`, `hmacSecurity.ts:175-179`.
