# CLAUDE.md — Development Guide

> Last updated: 2026-05-26 (full audit pass)
> Rule: **Audit → Plan → Execute**. Each change must be minimal, targeted, testable and reversible.

---

## Commands

```bash
# Install all dependencies
npm install

# Development
npm run dev:backend      # NestJS API on :3001
npm run dev:pos          # Electron POS app
npm run dev:backoffice   # React back-office on :5173

# Infrastructure
npm run docker:up        # Start local PostgreSQL
npm run docker:down      # Stop local PostgreSQL

# Testing (always run before committing)
npm run test             # All workspaces
npm run test:backend     # Backend only (543 tests, 81 spec suites; 3 gated-PG skipped)

# Code quality
npm run lint             # ESLint (all workspaces)
npm run format           # Prettier

# Migrations (backend — NEVER use db:push in prod)
cd packages/backend
npm run migration:generate -- src/database/migrations/MyChange
npm run migration:run
npm run migration:revert

# Build
npm run build:backend
npm run build:backoffice
npm run build:pos
```

---

## Architecture

**Monorepo** — npm workspaces with 5 packages + shared:

| Package | Tech | Purpose |
|---------|------|---------|
| `packages/backend` | NestJS 10 + TypeORM + PostgreSQL | Central API, all business logic |
| `packages/pos-desktop` | Electron + React + TypeScript | Desktop POS, offline-first, dual-window |
| `packages/backoffice-web` | React + TypeScript + Vite | Web management dashboard |
| `packages/mobile` | React + TypeScript + Vite (Capacitor-ready) | Wesley Club loyalty app |
| `packages/customer-app` | React + TypeScript | Customer-facing app |
| `shared/` | TypeScript | Shared types, utils, constants |

### Deployment (current)

| Layer | Where | URL |
|-------|-------|-----|
| Backend B (sandbox, Railway) | `vibrant-freedom` workspace | `caisse-backend-production.up.railway.app` |
| Backend A (canonical prod) | **DO NOT TOUCH** | `api.addxintelligence.com` |
| Backoffice | Railway static | `app.addxintelligence.com` |
| Database | Neon serverless PostgreSQL | `ep-square-violet-agqygacb-pooler` |

**Railway deploys are MANUAL** — GitHub App cross-account limitation (repo: `movo24/CAISSE`,
workspace: `y5ctnxgdc9-hue`). Use `serviceInstanceDeployV2(commitSha: "SHA")` via Railway API
or the dashboard. See `packages/backend/RUNBOOK.md` for exact curl commands.

---

## Backend Modules (42)

| Module | Purpose |
|--------|---------|
| `auth` | PIN + QR + email login, JWT generation, offline fallback |
| `mobile-auth` | Wesley Club customer JWT (audience: `mobile-app`) |
| `products` | CRUD, EAN scan, price history |
| `sales` | Full POS flow, hash chain, mock peripherals |
| `sales-ai` | Rule-based pricing suggestions, revenue forecast |
| `employees` | CRUD, QR badge generation |
| `customers` | QR loyalty, OTP verification |
| `customer-visits` | Visit tracking, frequency analytics |
| `stores` | Multi-store management, TW24 sync |
| `organizations` | Org hierarchy (org > unit > store) |
| `units` | Business units inside orgs |
| `reports` | Z-report generation, daily summaries |
| `promotions` | buy_x_get_discount, percentage, first_purchase |
| `stock` | Decrement, adjust, threshold alerts |
| `stock-locations` | Warehouse location management |
| `inventory-scan` | Barcode scan for inventory counting |
| `product-integration` | Unknown-barcode workflow: scan lookup, integration requests, PIN-gated product creation, statuses (POS = request only) |
| `audit` | SHA-256 hash chain, append-only log |
| `currency` | FX rates, multi-currency conversion |
| `sync` | Offline push/pull, conflict resolution |
| `notifications` | QR loyalty reminders, stock alerts |
| `subscriptions` | Plan management, billing hooks |
| `occupancy` | Store occupancy tracking |
| `jackpot` | Jackpot/lottery game for loyalty |
| `loyalty-card` | Customer loyalty card CRUD |
| `loyalty-admin` | Loyalty program admin |
| `coupon` | Coupon generation, redemption, idempotency |
| `pos-integration` | POS-to-loyalty bridge |
| `connected-apps` | OAuth/API key management for 3rd-party apps |
| `timewin` | TimeWin24 integration (HR source of truth) |
| `stripe-terminal` | Stripe Terminal hardware payments |
| `terminals` | Physical payment terminal registry |
| `receipts` | Receipt generation (PDF/QR) |
| `health` | DB ping, returns 503 on DB down for Railway healthcheck |
| `sales-guards` | Pre-sale guard evaluation (limits, blocking rules) |
| `airtable-ops` | Airtable linked-record sync operations |
| `returns` | Returns / credit notes (avoirs), NF525 chain, store-credit redemption |
| `shift-reminders` | Cron pre-shift reminders via SMS/email providers |
| `fiscal` | Fiscal journal + hash-chain verifier (NF525 groundwork; cert PARKED) |
| `pos-session` | Terminal-bound cashier sessions (open/close, X-report) |
| `stock-reconciliation` | Inventory variance ≥20% → human intervention (decision 7) |
| `promo-codes` | Shared promo codes: validate/redeem/reserve-at-sale, usage cap (decision 6) |
| `documents` | PDF generation (duplicata, avoir, Z-report) |

---

## TypeORM Entities (53)

Located in `packages/backend/src/database/entities/`. Key ones:

- `store.entity.ts` — `organizationId: uuid`, `unitId: uuid` (nullable)
- `customer.entity.ts` — `storeId: varchar`, `passwordHash: varchar(100)` (nullable)
- `coupon.entity.ts` — `lockedByIdempotencyKey: varchar(64)` (nullable)
- `sale.entity.ts` — all amounts are integers (centimes)
- `audit-entry.entity.ts` — **append-only, NEVER update or delete**

### TypeORM typing rule (CRITICAL)

Every nullable column with a TypeScript union type (`string | null`) **must** have an explicit
`type:` in `@Column()`. Otherwise TypeORM throws `DataTypeNotSupportedError: Data type "Object"` at boot.

```typescript
// WRONG — TypeORM reads TS union as "Object" at runtime
@Column({ nullable: true })
storeId: string | null;

// CORRECT — explicit type always
@Column({ name: 'store_id', type: 'uuid', nullable: true })
storeId: string | null;

@Column({ name: 'store_id', type: 'varchar', nullable: true })
storeId: string | null;  // use 'varchar' when prod column is character varying
```

---

## Migrations

- **Dev schema changes**: generate + run a migration, commit both files
- **Production**: migrations auto-run at boot (`migrationsRun: isProd` in `app.module.ts`)
- **NEVER** set `TYPEORM_SYNCHRONIZE=true` in production — app crashes at boot if detected
- **NEVER** use `db:push --accept-data-loss` — destructive and untraceable

Current migrations (run in order):
```
1700000000000-InitialSchema
1710500000000-HardeningIndexes
1710600000000-MultiEntityHierarchy
1710700000000-AddStoreIsArchived
1710800000000-InventoryScansAndStoreCodeUnique
1710900000000-RemoveRHAddPOSSessions
1711000000000-AddEmployeeStoreAccess
1712000000000-AddLoyaltySystem
1713000000000-AddAirtableOpsAndSalesGuards
1714000000000-AddCreditNotes
1715000000000-AddGiftCards
1716000000000-AddInventoryScanClientEntryId
1717000000000-AddFiscalJournal
1718000000000-AddSaleHashVersion
1719000000000-AddPosSessionTerminalId
1735000000000-CreateStockLocations
1736000000000-CreateTimewinEvents
1737000000000-CreateStockVariances
1738000000000-CreateBrandsSuppliers
1739000000000-CreateStoreProductPrices
1740000000000-AddProductVariants
1741000000000-CreatePromoCodes
1742000000000-AddSaleDiscountApprover
1743000000000-AddPaymentCapture
1745000000000-AddStoreLegalIdentity
1746000000000-AddProductStatusAndIntegrationRequests
1747000000000-AddEmployeeSystemScore
1748000000000-AddSaleSessionBinding
```
> Saut de numérotation 1719→1735 volontaire (réservation d'une plage pour les blocs POS).

---

## Security Rules (IMMUTABLE)

1. **Never commit secrets** — no API keys, tokens, passwords, webhook secrets in code
2. **`.env.example` only** — fictional placeholder values only, never real values
3. Real `.env` files must be in `.gitignore` — verify before every commit
4. **JWT_SECRET and JWT_REFRESH_SECRET**: ≥ 32 chars, `openssl rand -hex 32`
5. **JWT signing — no `aud` in payload** — use only `audience` in options:
   ```typescript
   // CORRECT
   jwt.sign({ sub: id, email }, secret, { audience: 'mobile-app' });
   // THROWS at runtime (duplicate aud claim)
   jwt.sign({ sub: id, aud: 'mobile-app' }, secret, { audience: 'mobile-app' });
   ```
6. **No DNS cutover** without explicit "GO DNS" from user
7. **No JWT regeneration** without explicit permission
8. **No modification to Backend A** (`api.addxintelligence.com`) — production canonical, untouchable
9. **No Cloudflare/Railway config changes** without explicit GO

---

## Multi-Tenancy (TenantInterceptor)

`TenantInterceptor` is applied globally in `main.ts`. It:
- Extracts `storeId` from the authenticated JWT payload (`req.user.storeId`)
- Blocks requests where `params.storeId / query.storeId / body.storeId` ≠ JWT storeId
- Sets `req.tenantStoreId` for services to use downstream
- Admins bypass (can access all stores)

Rules:
- Services must read `req.tenantStoreId` — **not** raw body/query storeId
- Use `@SkipTenantCheck()` decorator for public endpoints
- Role hierarchy: `admin (2) > manager (1) > cashier (0)`. Higher role inherits lower permissions.

---

## TimeWin24 Integration

- **TW24 = source of truth for employees and HR**
- **CAISSE = source of truth for stores** (but imports from TW24 on sync)
- Auth flow: TW24 first → CAISSE local DB fallback if TW24 unreachable
- Store sync endpoint: `POST /api/stores/sync` (@Roles('admin'))
  - Calls TW24 `/api/pos-feed/stores` → upserts stores in CAISSE DB
  - Auth: HMAC if `TIMEWIN24_POS_SECRET + TIMEWIN24_POS_KEY_ID` set, else Bearer `TIMEWIN24_API_KEY`
  - Returns `{ created: N, updated: N, total: N }`
  - **If sync returns `total: 0`**: check env vars `TIMEWIN24_POS_SECRET`/`TIMEWIN24_API_KEY` on Railway

---

## Code Conventions

- **All money is integers**: Use `MoneyAmount` type (centimes). Never floats.
- **Audit entries are append-only**: Never UPDATE or DELETE `audit_entry` rows
- **Hash chain**: Each audit entry references the previous SHA-256 hash — never break the chain
- **UUIDs**: Use UUID v4 for all entity IDs
- **Dates**: ISO 8601 everywhere
- **DB columns**: snake_case. TypeScript properties: camelCase
- **Shared types**: import from `@caisse/shared` (e.g. `@caisse/shared/types/store`)
- **Module structure**: each NestJS module requires: `*.controller.ts`, `*.service.ts`, `*.module.ts`
- **API base URL**: `http://localhost:3001/api` (dev). Port controlled by `PORT` env var (Railway injects 8080).

---

## POS / Sales Integrity (NF525)

### Idempotency of sales transactions (CRITICAL)

Any sale creation, payment, or synchronization endpoint **must** use an idempotency key.
A double network submission, double-click, mobile retry, or offline sync replay must **never** create two sales.

Rules:
- Every POS transaction that writes money must carry a client-generated idempotency key
- The backend must **reuse or reject** a transaction with an already-processed key — never create a duplicate
- The `IdempotencyKey` entity is the central mechanism for all critical write operations, not only coupons
- Applies to: sale creation, payment capture, ticket emission, offline sync push, coupon redemption, any financial reversal
- If an idempotency key is reused with **different parameters**, reject with 409 Conflict — do not silently accept

### Sale / ticket immutability (CRITICAL — comptable / NF525)

A validated sale **must never be directly modified**.

Rules:
- No `UPDATE` on a validated sale row — period
- Corrections must go through: cancellation, credit note (avoir), counter-entry, or a new append-only audit event
- The hash chain (`audit-entry`) and the ticket must remain mutually consistent at all times
- No migration, script, or manual DB query may rewrite validated sale history without an explicit, documented procedure
- This is not optional: silently modifying a validated sale breaks NF525 compliance and audit trail integrity

### Z-report immutability

- A generated Z-report is **frozen** — it reflects the shift state at the moment of generation
- Any discrepancy discovered after generation must be recorded as a separate corrective entry, never by editing the Z-report
- No code path should allow `UPDATE` or `DELETE` on a Z-report record

---

## Environment Variables

Validated at boot in `main.ts`. Missing required vars crash the server with a clear message.

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | YES | Neon: `postgresql://...?sslmode=require` |
| `JWT_SECRET` | YES | ≥ 32 chars, `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | YES | ≥ 32 chars, different from JWT_SECRET |
| `NODE_ENV` | YES | `development` or `production` |
| `PORT` | NO | Railway injects 8080. Defaults to 3001. `targetPort` on Railway domain MUST match. |
| `REDIS_URL` | NO | Without it: in-memory cache (not multi-instance safe) |
| `TIMEWIN24_URL` | NO | TW24 base URL |
| `TIMEWIN24_API_KEY` | NO | Bearer auth for TW24 |
| `TIMEWIN24_POS_SECRET` | NO | HMAC key for TW24 pos-feed routes |
| `TIMEWIN24_POS_KEY_ID` | NO | Key ID for TW24 HMAC auth |
| `STRIPE_SECRET_KEY` | NO | `sk_test_...` / `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | NO | `whsec_...` |
| `SENTRY_DSN` | NO | Error tracking |
| `CORS_ORIGIN` | NO | Comma-separated list of allowed origins |
| `TRUST_PROXY_HOPS` | NO | Number of front proxies to trust for client IP (default 1). Behind Railway/Cloudflare so `req.ip` + rate-limit see the real client. Never `true`. |
| `LOGIN_FAIL_MAX` | NO | Failed logins per IP before lockout (default 10) |
| `LOGIN_FAIL_WINDOW_SEC` | NO | Rolling window for counting failures (default 900s) |
| `LOGIN_LOCK_SEC` | NO | Lockout cooldown after threshold (default 900s) |
| `ENABLE_SWAGGER` | NO | Set `true` to expose `/api/docs` in production (off by default) |

---

## Tests

543 tests across 81 spec suites (`packages/backend/test/` + colocated `*.spec.ts`; 3 gated-PG `*.pg.spec.ts` skipped without `TEST_DATABASE_URL`). Key suites:

| File | Coverage |
|------|----------|
| `audit.spec.ts` | Hash chain integrity, append-only enforcement |
| `auth-security.spec.ts` | JWT validation, role guards, token revocation |
| `currency.spec.ts` | FX conversion, rounding rules |
| `loyalty-flow.spec.ts` | Full loyalty card lifecycle |
| `money-precision.spec.ts` | Integer money arithmetic, no float drift |
| `promo.spec.ts` | buy_x_get_y, percentage, first_purchase |
| `report.spec.ts` | Z-report aggregation |
| `sale-transaction.spec.ts` | Full POS sale flow, stock decrement |
| `stock.spec.ts` | Stock movements, threshold alerts |
| `tenant-isolation.spec.ts` | Cross-store data isolation |

**Run `npm run test:backend` before every commit. If any test fails, stop.**

---

## Pre-Modification Workflow

Before editing any file:
1. **Read** the file and its related spec
2. **Grep** all callers: `grep -r "SymbolName" packages/backend/src/`
3. **Check** migration state if touching entities or DB schema
4. **Plan** the minimal change (one file / one concern)
5. **Execute** — targeted edit, not batch rewrites
6. **Test** — `npm run test:backend` must pass
7. **Security check** — no secrets in diff, `.gitignore` intact

---

## Key Files Reference

```
packages/backend/
  src/main.ts                                   Bootstrap, env validation, Swagger, global pipes
  src/app.module.ts                             Module registry, TypeORM, rate-limit tiers
  src/database/typeorm.config.ts                Migration CLI config
  src/database/entities/                        45 TypeORM entities
  src/database/migrations/                      11 versioned migrations
  src/common/guards/roles.guard.ts              Role hierarchy (admin > manager > cashier)
  src/common/guards/jwt-auth.guard.ts           JWT authentication guard
  src/common/interceptors/tenant.interceptor.ts Multi-tenant storeId enforcement
  src/modules/timewin/timewin.service.ts        TW24 API client (HMAC + Bearer)
  src/modules/stores/stores.service.ts          syncFromTimeWin(), store CRUD
  src/modules/auth/auth.service.ts              Login flows (TW24 first, local fallback)
  src/modules/mobile-auth/mobile-auth.service.ts Wesley Club JWT (audience: mobile-app)
  RUNBOOK.md                                    Railway IDs, curl commands, manual redeploy
  DNS-CUTOVER-CHECKLIST.md                      DNS flip checklist (NOT to be run yet)
  MONITORING-PLAYBOOK.md                        UptimeRobot, GO/NO-GO, rollback

packages/backoffice-web/
  src/stores/authStore.ts                       Zustand: auth + stores state, localStorage cache
  src/services/api.ts                           Full API client (axios, token refresh interceptor)
  src/pages/StoresManagementPage.tsx            Magasins admin (calls storesApi.list())

shared/
  types/                                        12 modules of shared TS interfaces
  utils/money.ts                                Currency formatting/conversion
  utils/hash.ts                                 Audit hash chain utilities
```

---

## Known Issues / Open Items

> **Suivi vivant** : feuille de route modulaire → [`MASTER_ROADMAP.md`](MASTER_ROADMAP.md) ;
> état + worklist P0/P1 → [`PROJECT_STATUS.md`](PROJECT_STATUS.md) ; registre de dette canonique →
> [`TECHNICAL_DEBT.md`](TECHNICAL_DEBT.md) ; journal d'exécution → [`EXECUTION_LOG.md`](EXECUTION_LOG.md).
> Le tableau ci-dessous est le miroir humain ; la source unique de la dette est `TECHNICAL_DEBT.md`.

| Issue | Status | Fix |
|-------|--------|-----|
| Admin Magasins shows 0 stores | Open | `POST /api/stores/sync` must succeed. Requires `TIMEWIN24_POS_SECRET` or `TIMEWIN24_API_KEY` on Railway. |
| Railway deploys not auto-triggered | Structural | Cross-account GitHub limit. Manual via `serviceInstanceDeployV2`. See RUNBOOK. |
| In-memory cache (no Redis) | Low risk | Set `REDIS_URL` before multi-instance prod. |
| Backend A untouched | Hard constraint | `api.addxintelligence.com` = prod canonical. Never touch without explicit GO. |
| Cash-sale fiscal reversal via `createReturn` — UNCOVERED | **Named debt** | The `void-cash-realized` guard blocks voiding a sale with a realized cash leg; such a sale must be reversed via `createReturn` (cash refund), not `void`. The fiscal-chain/journal behaviour of that **createReturn-cash** path is **not yet tested/carried**. M3/M4 specs were transposed onto non-cash tenders (M3 → `store_credit`, M4 → `card`) to preserve their assertions after the guard landed. See [TECHNICAL_DEBT.md](TECHNICAL_DEBT.md) (D1). Address in a **separate fiscal-design PR** — do not let it disappear silently. |

---

## Apple Strategy

3 iOS apps + 1 web backoffice, layered releases — POS first:

| Priority | App | Platform | Bundle ID |
|----------|-----|----------|-----------|
| V1 (NOW) | POS Caisse | iPad | `com.addxintelligence.poscaisse` |
| V2 | Inventaire | iPhone | `com.addxintelligence.inventory` |
| V3 | TimeWin24 | iPhone | `com.addxintelligence.timewin24` |
| Web | Backoffice | Web only | — |

**Never submit everything at once. One app at a time.**

---

## POS Caisse execution protocol

Use the `information` skill for all POS Caisse development work.

Default behavior:
- execute validated modules autonomously;
- protect payment, fiscal, discount, stock and sync invariants;
- never mark uncaptured card payments as paid;
- enforce responsible-code discount cap at 30%;
- forbid duplicate events;
- validate through typecheck, lint, tests and build where applicable;
- stop only for real blockers;
- continue automatically to the next validated module.

---

## Operating charter (subordinated — Tier-2 supreme)

Full text: [`.claude/rules/continuity.md`](.claude/rules/continuity.md). Ratified by the
owner; **repo-persisted only**, never loaded as cross-session memory that pre-authorizes
autonomy. The continue-default below is **subordinate** to the Tier-2 gate.

- **Tier-2 always requires an explicit, per-action owner GO.** A "continue", a "go", or a
  reference to an earlier message **never** opens a Tier-2 action. Tier-2 = secrets/2FA,
  real payment/capture, irreversible deletion/purge, dangerous prod, sensitive/irreversible
  migration (incl. sales/payments/stock/products), mass UPDATE/DELETE, fiscal/NF525-structural
  change, merge to `main`, non-trivial Git conflict, unresolved product/architecture decision.
- **A Tier-2 (esp. fiscal/payment) gate closes only on the owner's explicit words in-channel** —
  never on the agent's citation of a prior message.
- **Continue-default applies only to actions that are** non-dangerous, reversible, testable,
  in a branch, without direct production effect, and within already-validated scope.
- This charter is **persisted in the repo only**, not as permanent cross-session memory that
  pre-authorizes autonomy.
