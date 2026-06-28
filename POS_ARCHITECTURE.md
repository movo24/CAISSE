# POS_ARCHITECTURE.md — Architecture réelle (vérifiée 2026-06-28)

> Cartographie issue de l'inspection du code, pas de la documentation.

## Monorepo (npm workspaces)

```
CAISSE/
├── packages/
│   ├── backend/        NestJS 10 + TypeORM + PostgreSQL (API centrale, logique métier)
│   ├── pos-desktop/    Electron + React + TS (POS, offline-first, Capacitor-ready iOS)
│   ├── backoffice-web/ React + Vite (dashboard gestion)
│   ├── mobile/         React + Vite (Wesley Club / loyalty)
│   └── customer-app/   React (app client)
└── shared/             types, utils (money/hash), constants
```

## Backend — 40 modules (vérifié)

```
airtable-ops, audit, auth, connected-apps, coupon, currency, customer-visits,
customers, documents, employees, fiscal, health, inventory-scan, jackpot,
loyalty-admin, loyalty-card, mobile-auth, notifications, occupancy, organizations,
pos-integration, pos-session, products, promotions, receipts, reports, returns,
sales, sales-ai, sales-guards, shift-reminders, stock, stock-locations, stores,
stripe-terminal, subscriptions, sync, terminals, timewin, units
```

Surface API : **37 controllers**, **213 routes**. Bases `@Controller` relevées :
`admin/loyalty, airtable-ops, audit, auth, connected-apps, currency, customers, employees, health, inventory-scans, jackpot, mobile, mobile/coupons, notifications, occupancy, organizations, pos-sessions, pos/loyalty, products, promotions, realtime, receipts, reports, returns, sales, sales-ai, sales-guards, stock, stock-locations, stores, stripe-terminal, subscriptions, sync, terminals, timewin, units`.

## Entités TypeORM — 47 (vérifié)

Noyau caisse/fiscal : `sale`, `sale-line-item`, `sale-payment`, `audit-entry`, `fiscal-journal`, `z-report`, `idempotency-key`, `pos-session`, `credit-note(+line/redemption)`, `sale-anomaly-log`.
Catalogue/stock : `product`, `product-category`, `product-store-availability`, `product-highlight`, `price-history`, `stock-balance`, `stock-movement`, `stock-location`, `inventory-scan`.
Org/employés : `organization`, `unit`, `store`, `store-context`, `employee`, `employee-store-access`.
Loyalty/clients : `customer`, `customer-device`, `customer-visit`, `loyalty-card`, `loyalty-reward-cycle`, `coupon`, `jackpot-config`, `jackpot-win`.
Divers : `payment-terminal`, `fx-rate`, `connected-app`, `subscription`, `notification(s)`, `airtable-*`, `ai-recommendation-log`.

## POS Desktop (vérifié)

- Electron : `src/main/index.ts`, `src/main/preload.ts` (2 fichiers main).
- Renderer pages : `LoginPage.tsx`, `POSPage.tsx`, `ClientDisplayPage.tsx` (dual-window confirmé via ClientDisplay).
- Écrans caisse = **composants** dans `components/pos/` et `components/ipad/` (pas des routes séparées) : ex. `ReturnModal`, `IPadPOSLayout`, `ScannerTool`.
- Services : `syncEngine.ts`, `offlineStore.ts` (store), `api.ts`, `hmacSecurity.ts`, `cloudSyncIdentity.ts`, `posEventBus.ts`.
- Hooks périphériques/paiement : `useStripeTerminal`, `useBluetoothPrinter`, `useBluetoothScanner`, `useScannerZXing`, `useOfflineMode`, `usePayment`, `useCart`, `useDeviceProfile`.

## Couches transverses backend (vérifié)

- Multi-tenant : `common/interceptors/tenant.interceptor.ts` (storeId from JWT).
- RBAC : `common/guards/roles.guard.ts` (admin>manager>cashier), `jwt-auth.guard.ts`.
- Résilience : `common/resilience/circuit-breaker.ts` (+ spec).
- Audit : hash-chain SHA-256 append-only (`audit` + `fiscal` + `utils/hash.ts`).

## Déploiement (selon CLAUDE.md — non re-vérifié en live)

- Backend B sandbox : Railway `caisse-backend-production.up.railway.app`.
- Backend A canonique : `api.addxintelligence.com` — **INTOUCHABLE**.
- Backoffice : `app.addxintelligence.com`. DB : Neon Postgres.
- Déploiements Railway **manuels** (limite GitHub cross-account).
