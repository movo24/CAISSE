# API_CONNECTION_MAP — Carte des connexions API

> Audit 2026-07-10, `main` @ `6238350`. Qui parle à qui, par quel transport, avec quelle auth.

## Transport par client (recoupé avec les routes backend réelles)

| Client | Fichier | baseURL prod | Préfixe | Stockage token | Timeout |
|---|---|---|---|---|---|
| POS desktop | `pos-desktop/src/renderer/services/api.ts` | `https://api.addxintelligence.com/api` (absolu) | `/api` | localStorage | 15 s |
| Backoffice | `backoffice-web/src/services/api.ts` | `''` → `/api` (relatif, rewrite Vercel) | `/api` | localStorage | 15 s |
| Mobile staff | `mobile/src/services/api.ts` | `https://api.addxintelligence.com` (absolu) | `/api` | localStorage | 15 s |
| Customer-app | `customer-app/src/services/api.ts` | `https://api.addxintelligence.com/api/mobile` (absolu) | `/api/mobile` | Capacitor Preferences | 15 s |

- Seul le **backoffice** est same-origin (immunisé CORS). Les 3 autres tapent le backend en **absolu cross-origin** → `CORS_ORIGIN` doit énumérer `pos.` `m.` `mobile.` + domaine customer-app, sinon préflight bloqué.
- Aucun client ne pose `withCredentials` → le cookie httpOnly `caisse_refresh_token` n'est jamais transmis ; le refresh passe par le body (localStorage).
- Séparation d'audience stricte : routes `/api/mobile/*` exigent `aud:mobile-app` (`MobileAuthGuard`), les routes staff passent par `JwtAuthGuard`. Un token ne franchit pas la frontière.

## Flux applicatifs (client → endpoint → module backend)

### POS desktop
- Auth : `POST /api/auth/login/pin|qr`, `POST /api/auth/refresh|logout` → `auth`
- Ventes : `POST /api/sales`, `GET /api/sales/:id`, void/regularize → `sales`
- Sessions : `/api/pos-sessions/*` → `pos-session`
- Produits : `GET /api/products/scan/:ean`, `GET /api/products/categories`, `GET /api/products` → `products`
- Paiement : `POST /api/stripe-terminal/connection-token`, `GET /api/stripe-terminal/status`, `/api/terminals/*` → `stripe-terminal`/`terminals`
- Fidélité : `/api/pos/loyalty/*` → `pos-integration`
- Guards : `POST /api/sales-guards/evaluate` → `sales-guards`
- Occupancy : `GET /api/occupancy/:storeId` → `occupancy`
- Sync : `POST /api/sync/push`, `GET /api/sync/pull|status` → `sync`
- **🔴 morts** : `GET /api/weather/*` (aucun contrôleur → 404, appelé `usePOSLifecycle.ts:101`) ; `GET /api/occupancy/:storeId/weather` (route supprimée → 404, appelé `POSPage.tsx:403`).

### Backoffice
- Produits : list/get/create/update/delete, variants, store-price, components, import/export CSV, price-analytics → `products`
- Stock : `POST /api/stock/:id/adjust`, alertes via `/api/notifications/stock-alerts` → `stock`/`notifications`
- Ventes/rapports : `/api/sales`, `/api/reports/*` → `sales`/`reports`
- Marques/fournisseurs : `/api/products/brands|suppliers` → `products`
- Gestion : stores, employees, terminals, sessions, employee-scores, airtable-ops, connected-apps, subscriptions
- **⚫ orphelins (0 usage UI)** : `productsApi.priceHistory` (`GET /products/:id/price-history`), `productsApi.generateBarcode` (barcode généré en SVG local).

### Mobile staff (inventaire)
- Auth PIN + refresh + logout ; produits list/scan/create/categories/update ; `POST /api/stock/:id/adjust` (avec `mode`) ; inventory-scans.
- Note : `mobile productsApi.create` envoie **déjà** les bons noms DTO (`priceMinorUnits`, `stockQuantity`, `categoryId`, `taxRate`, `costMinorUnits`…) — référence de l'alignement corrigé en R1 côté backoffice.

### Customer-app (Wesley Club)
- `POST /api/mobile/auth/register|login|refresh|logout` ; `GET/PATCH/DELETE /api/mobile/me` ; `/api/mobile/loyalty-card`(+regenerate-qr) ; `/api/mobile/coupons`(+active,history). 100 % des routes matchées, audience `mobile-app` imposée, stockage natif. ✅

## Infra & externes (backend → …)

```
backend ──TypeORM/pg──► PostgreSQL (Neon)          ✅ pool 30, migrationsRun=prod, health 503
backend ──ioredis─────► Redis (cache)              🟢 fallback mémoire (ALLOW_INMEMORY_CACHE)
backend ──ioredis─────► Redis (realtime SSE)       🟢 fallback in-process
backend ──(rien)──────► Redis (throttler)          🔴 mémoire malgré doc "Redis"
backend ──(rien)──────► Redis (occupancy)          ⚫ Map mémoire
backend ──Stripe SDK──► Stripe (terminal+billing)  ✅ card-present + webhook billing signé
backend ──axios───────► Airtable REST              🕓 réel, AIRTABLE_ENABLED=false par défaut
backend ──REST/SMTP───► SendGrid / SMTP (reçus)    🟢 no-op sans clé
backend ──webhook─────► Slack/Discord (alertes)    🟢 ALERT_WEBHOOK_URL
backend ──HMAC/Bearer─► TimeWin24 pos-feed         🟠 login local-first, sync stores destructif
backend ──(rien)──────► Comptamax24 / Analytik R   ⚫ zéro code (prévu)
CI ──GraphQL──────────► Railway (deploy/domains)   🟠 token, deploy non prouvé sur disque
CI ──X-API-Key────────► IONOS DNS                  🟠 verify bloqué (clé format invalide)
```

## Déploiement (contrainte structurelle)

Railway ne peut pas poser de webhook sur `movo24/CAISSE` (GitHub App sur un autre compte) → **aucun auto-deploy**. Chaque commit main exige `serviceInstanceDeployV2(commitSha)` manuel (API/dashboard/workflow railway-live). Preuve : `RUNBOOK.md:41-52`, `CLAUDE.md:67-69`. Incohérence doc : workspace nommée `vibrant-freedom` (RUNBOOK) vs `y5ctnxgdc9-hue` (CLAUDE.md) — à harmoniser.
