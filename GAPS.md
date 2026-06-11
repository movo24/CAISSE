# Gap-to-SaaS audit — CAISSE

> **Read-only audit, code-grounded** (2026-06-11). Maps the real state of the
> code (entities, modules, migrations, frontend, config) against a
> production-grade, NF525-defensible fiscal POS SaaS. Append-only — supersede,
> never delete.
>
> Method: 4 parallel read-only explorations (domains B–M) + the fiscal/Stripe
> domains (A, E) from the working knowledge of this session, with the most
> consequential claims re-verified directly (notably H4, the offline chain).
>
> **"Absent" means searched-and-confirmed-missing** (the search location is
> stated), not "couldn't find". Tags: **[M]** needed for a single defensible
> store · **[S]** needed for the SaaS. Severity: 🔴 fiscal/legal-blocking ·
> 🟠 operational · 🟢 comfort.

---

## Synthesis — the critical path (read this first)

### Reframe: the operational surface is far more built than a flat "20-25%"

The audit found a **substantially complete operational product**: full POS
cashier UI (cart/payment/receipt), full back-office (20+ routes), full hardware
(ESC/POS thermal printer, cash-drawer kick, barcode scanner, email receipts with
legal mentions), multi-tender + cross-tender refunds, product catalog (SKU/EAN/
tax-per-product/categories), 3-layer stock + movements journal, org→unit→store
hierarchy, TenantInterceptor, employee CRUD + PIN/QR, an audit hash-chain, and a
**working SaaS-billing layer** (Stripe Billing for merchants: plans, trial,
dunning, suspend-on-nonpayment). Domains F/G/M/D sit at ~70–85%.

So the gaps are **concentrated**, not spread. The route to a defensible store is
tight and clear: finish the fiscal closure, fix the offline chain, produce the
attestation, enforce rights server-side. The SaaS-ification is a separate, later
layer.

### Top 🔴 [M] — route to a single defensible store (these block a compliant open)

1. **Offline POS forks / breaks the fiscal hash chain.** `sync.service.ts:121`
   raw-`save`s offline sales (no `createSale`, no `FOR UPDATE` lock, no sha256);
   `sale.entity.ts:64-68` makes `hash_chain_prev/current` **nullable** → an
   offline sale lands hash-less, off-chain. *And* the client cloud-sync loop is
   reported as a stub (`cloudSyncIdentity.ts` TODO) → offline sales may not sync
   at all (unrecorded). Either failure mode is 🔴 fiscal. **As urgent as the Z.**
2. **Z-report not sealed/chained + no perpetual grand total** (Finding A) — the
   closure is a mutable row; NF525 requires it inalterable + a never-reset cumul.
3. **Returns absent from the Z total** (Finding B) — `generateZReport` sums
   `completed` sales only, never reads `credit_notes` → over-declaration.
4. **Éditeur self-attestation absent** (L1) — `nifCaisse` is a receipt label, not
   a structured per-merchant attestation. Legal deliverable for NF525-defensible.
5. **Fine-grained rights defined but NOT enforced server-side** (C2) —
   `employees.service.ts:18-55` defines `canVoidSale/canRefund/...` but no
   service checks them; the void limit is a hardcoded role check. A crafted
   request bypasses the frontend-only enforcement.
6. **Manager-approval (override PIN) absent** (C4) — no "cashier requests manager
   PIN to authorize void/discount/refund" flow; only coarse role rejection.
7. **Fiscal-chain anomaly alerts not wired** (H2) — `fiscal-verify.service.ts`
   detects fork/orphan/hash_mismatch but never fires `AlertService`. Integrity
   violations are silent until a manual verify run.
8. **(carried)** Cash-drawer reconciliation absent (Finding D); device-credential
   for authoritative attribution (#4).

### Top 🔴 [S] — route to the SaaS

1. **RGPD anonymization cron absent + RGPD-vs-fiscal-retention conflict
   unacknowledged** (I1) — `deleteMe()` sets `deletedAt` and promises a 30-day
   scrub cron that **does not exist**; no carve-out for fiscally-retained sale
   linkage. The conflict is undocumented.
2. **CGU / DPA / SaaS contract absent** (L2) — none in repo (privacy policy is an
   external URL). You are the merchants' data processor → a DPA is mandatory.
3. **Merchant onboarding / signup absent** (J) — no self-serve tenant creation;
   provisioning is manual multi-step admin calls.
4. **Tenant isolation: RLS absent + `GET /organizations` unguarded** (B2) — any
   authenticated user can list all organizations (`organizations.controller.ts:27`).
   No row-level security; isolation is application-level manual `WHERE`.
5. **Feature-gating not wired** (D2) — `enforceFeature/enforceProductLimit/...`
   exist but have zero call sites.
6. MFA/SSO absent (C6); no deploy pipeline / staging / rollback (H1); no app-level
   backup/DR or fiscal export (H3).

### Rough completeness by domain

| Domain | ~% | Note |
|---|---|---|
| A. Fiscal NF525 | ~50% | M1–M5 + verifier done; Z-seal / returns-in-total / cash-recon / **offline-chain** / attestation missing |
| B. Multi-tenant | ~40% | hierarchy + interceptor present; RLS / provisioning / per-tenant-config missing |
| C. Identity/RBAC | ~60% | CRUD / PIN / QR / audit present; fine-grained-enforcement / manager-approval / lifecycle / MFA missing |
| D. SaaS billing | ~70% | Stripe Billing full; feature-gating unwired, VAT-on-invoices missing |
| E. Payments/tenders | ~65% | multi-tender / cross-tender / PI lifecycle present; Stripe refund unwired, webhook-reconciler missing, Connect absent, card-present sealing not built |
| F. Catalog/stock | ~85% | catalog / scan / 3-layer stock present |
| G. Back-office/reporting | ~70% | dashboard + 20 routes present; super-admin / impersonation / FEC export / per-employee reporting missing |
| H. Ops/reliability | ~40% | alerting / health / rate-limit / pooling present; CI-deploy / staging / rollback / backup / **offline-fiscal** / APM missing |
| I. Security/RGPD | ~30% | env-secrets + soft-delete schema present; cron / consent / encryption / dep-scan / retention-conflict missing |
| J. Onboarding | ~5% | absent |
| K. Support | ~5% | absent |
| L. Legal/attestation | ~10% | labels only; attestation / CGU / DPA absent |
| M. Frontend/hardware | ~85% | POS UI / admin UI / printer / drawer / scanner / receipts present; RN gateway for WisePad 3 (BT) missing |

---

## Domain detail

### A. Fiscal NF525 (core) — known findings (this session's work)
- **Z-report sealing (Finding A)** — ABSENT. `z_reports` is a mutable row,
  `@Index(['storeId','date'],{unique:true})` only; no hash chain, no perpetual
  total. 🔴 [M]. Specced (ADR-009, A/B spec), OPEN decisions A-1/A-2/A-5.
- **Returns in the total (Finding B)** — ABSENT. `reports.service.ts:30-44` sums
  `completed` sales only. 🔴 [M]. Specced; event-time imputation OPEN (A-4).
- **Offline chain (H4)** — BROKEN. `sync.service.ts:121` raw-save; hash columns
  nullable. 🔴 [M]. **New — must be on the A list.**
- **Cash reconciliation (Finding D)** — ABSENT. Z reports theoretical cash only;
  no counted/variance. 🟠→🔴 [M] (the detective anti-skim). Sub-system, queued.
- **Attribution (1b)** — DONE (side-table, 3 doors proven). v3 bascule / device-
  credential / gift-card door / sister-of-#7 / authoritative recompute OPEN
  (see DECISIONS.md).
- **fiscal:verify** — present (`fiscal-verify.service.ts`), but **not alerting**
  (H2) — detects, never fires AlertService. 🔴 [M] to wire.
- **Periodic inalterable archive + DGFiP/FEC export** — ABSENT (H3/G3 confirm no
  app-level fiscal export). 🔴 [S] (and arguably [M] for a defensible audit).

### B. Multi-tenant
- Org→Unit→Store hierarchy: PRESENT (`store.entity.ts:24-29`, nullable FKs). [S]
- TenantInterceptor: PRESENT, global (`tenant.interceptor.ts:40`, `main.ts:274`);
  admin bypasses. `@TenantStoreId()` decorator unused (dead). [S]
- RLS: ABSENT (searched all migrations + TS). [S] 🔴 — **options: app-level WHERE
  (current) / Postgres RLS / schema-per-tenant / DB-per-tenant.** For fiscal data,
  stronger isolation is a real decision.
- `GET /organizations` unguarded: any auth user lists all orgs
  (`organizations.controller.ts:27`). 🔴 [S] leak.
- Per-store fiscal params: PRESENT (`store.entity.ts:53-99`); per-org inheritance
  ABSENT. Feature-flags-per-tenant ABSENT. [S]
- Provisioning: PARTIAL (manual multi-step; `subscriptions.controller.ts:104`
  trial). No signup saga. [S]

### C. Identity / RBAC / employees
- Employee CRUD: PRESENT (`employees.controller.ts:52-125`); lifecycle binary
  `isActive` only — no suspended/terminated (`employee.entity.ts:43`). [M]
- Multi-store access pivot: table present, **no controller endpoint**
  (`employee-store-access.entity.ts:4`). [M]
- Coarse RBAC (cashier/manager/admin): PRESENT (`roles.guard.ts:18`,
  `permissions.ts:57`). [M]
- **Fine-grained rights: defined, NOT enforced** (`employees.service.ts:18-55`,
  informational API only). 🔴 [M].
- PIN/QR credential: PRESENT (`employee.entity.ts:34-35`, bcrypt cost 12). [M]
- **Manager-override approval: ABSENT** (searched all modules). 🔴 [M].
- Audit log hash-chain: PRESENT but **selective** (`audit.service.ts:40`); no
  universal coverage (no entry for employee create/update, store open/close,
  price change). [M]
- MFA / SSO: ABSENT (searched). [S]
- **POS session open / createSale have NO `@Roles` guard** (`pos-session.
  controller.ts:25,55`, `sales.controller.ts:26`) — any authenticated user. (The
  void/cash guard and the future role-gate-on-void issue #5 are the fiscal slice.)

### D. SaaS billing
- Merchant subscription (Stripe Billing): PRESENT and real — plans/trial/dunning/
  suspend (`subscriptions.service.ts:30-93,383-435`, `stripe-billing.service.ts`).
  Quotas stored (`subscription.entity.ts:75-85`). [S]
- Feature-gating: PARTIAL — `enforceFeature/...` defined
  (`subscriptions.service.ts:261-311`), **zero call sites**. [S] 🟠.
- VAT on SaaS invoices: ABSENT — no `automatic_tax`/`tax_rates`/`tax_id_collection`
  in checkout (`stripe-billing.service.ts:72-94`). [S] 🟠.

### E. Payments / tenders
- Multi-tender split: PRESENT (`sales.service.ts:36-43,312-334`). [M]
- Methods: cash / card / store_credit (`sale-payment.entity.ts:14`, plain varchar,
  no enum). Gift-card = store_credit avoir, not a distinct method. [M]
- Cross-tender refund: PRESENT (`returns.service.ts:26,85`) — but **card refund
  does NOT call Stripe** (records the credit_note only). 🔴 [M] to wire (ADR-010).
- Stripe Connect: ABSENT (single platform account, `stripe.module.ts:6-16`). [S]
  **option: platform-account (current) vs connected-accounts + application_fee.**
- Card-present (Stripe Terminal): PI lifecycle present (`stripe-terminal.service.
  ts`), `capture_method:'automatic'`, **no PI webhook**, sale links via client-
  passed PI id. Sealing/webhook/manual-capture = ADR-010 (build OPEN, after A/B).

### F. Catalog / stock
- Catalog: PRESENT — EAN unique, price/cost/tax-per-product, categories,
  store-availability, price-history (`product.entity.ts:13-63`,
  `product-category.entity.ts`). [M] 🟢
- Barcode scan: PRESENT (`modules/inventory-scan`, idempotent via clientEntryId). [M]
- Stock: PRESENT — 3 layers (denormalized `products.stock_quantity`,
  `StockBalanceEntity` per location, immutable `StockMovementEntity` with 10
  types), locations, adjustments. [M] 🟢

### G. Back-office / reporting
- Merchant dashboard: PRESENT — 20+ real routes (`backoffice-web/src/main.tsx:72`).
  [M/S] 🟢
- Super-admin / impersonation / cross-tenant oversight: ABSENT (no rank above
  `admin`, no impersonation). [S] 🟠
- Reporting: PARTIAL — Z, daily-summary, store-kpi, product-analytics, sales-trend
  present (`reports.controller.ts`); **no per-employee breakdown, no multi-store
  aggregation, no FEC/PDF fiscal export** (CSV top-products only). [M/S]

### H. Ops / reliability
- CI: PARTIAL — `ci.yml` (lint/test/tsc), `desktop-build.yml` (Windows exe). **No
  deploy pipeline, no staging, no rollback.** [M/S] 🟠
- Monitoring: PARTIAL — `AlertService` (webhook + dedup), `/health` honest DB/Redis/
  TimeWin probes, `sale_anomaly_logs`. **Fiscal-chain anomalies NOT wired to
  alerts** (H2). No Sentry/APM. 🔴 [M] for the fiscal-alert wiring.
- Backups/DR: ABSENT app-level (relies on undocumented Neon PITR; no FEC/signed
  dump). 🟠 [M/S].
- **Offline POS: queue present (`useOfflineMode.ts`, `usePayment.ts:185`) but
  forks the fiscal chain on sync (H4) + client sync loop is a stub.** 🔴 [M].
- Scaling: pooling `max:30` (`app.module.ts:77`), 3-tier throttle. Hash-chain
  `FOR UPDATE` per store = sequential bottleneck per busy store. 🟠 [S].

### I. Security / RGPD
- RGPD: PARTIAL — soft-delete schema (`customer.entity.ts:58-62`), `deleteMe()`
  (`mobile-auth.service.ts:138`). **Anonymization cron ABSENT** (promise, no
  mechanism). **Consent collection ABSENT.** **RGPD-vs-fiscal-retention conflict
  unacknowledged** (no carve-out for fiscally-retained sale linkage). 🔴 [S].
- Secrets: PARTIAL — env vars via platform UI (advisory); no secrets-manager,
  no rotation. 🟠 [S].
- Encryption-at-rest (PII) / dep-scanning / pen-test: ABSENT. 🟠 [S].

### J. Onboarding — ABSENT. No signup / config wizard / reader-pairing-wizard /
import-from-previous-POS. Router starts at `/login`. 🔴 [S].

### K. Support — ABSENT. No ticketing / status page / SLA. 🟢 [S].

### L. Legal / attestation
- **Éditeur self-attestation per merchant: ABSENT** — `nifCaisse` is a label
  (`seed.ts:62`, `TicketHistoryModal.tsx:399`); no structured attestation, no
  per-merchant tracking. 🔴 [M].
- **CGU / DPA / SaaS contract: ABSENT** in repo (privacy = external URL). 🔴 [S].

### M. Frontend / hardware
- POS cashier UI: PRESENT — full (`pos-desktop/.../POSPage.tsx`, iPad layout,
  tender flow). 🟢 [M]
- Admin UI: PRESENT — 20+ routes. 🟢 [S]
- Mobile package = loyalty/inventory app, **NOT the Stripe Terminal gateway**
  (confirmed). The WisePad 3 (Bluetooth) RN gateway is OPEN (ADR-010). 🟠 [M]
- Hardware: PRESENT — ESC/POS thermal printer + cash-drawer kick
  (`useBluetoothPrinter.ts`), USB/WebUSB fallback, email/HTML receipt with
  SIRET/TVA/NIF legal mentions (`receipts.controller.ts`), barcode scanner
  (wedge/camera/BLE). 🟢 [M]

---

## Scope boundary (ratified by owner)
- **France / NF525 only at V1.** Multi-country (each country its own fiscal
  regime) is explicitly excluded from V1 — enormous, out of scope.

## Decisions surfaced by this audit (OPEN — owner's call, not filled)
- Tenant isolation model (B2): app-WHERE / Postgres-RLS / schema-per-tenant /
  DB-per-tenant — for fiscal data, the rigor bar is high.
- Stripe Connect vs platform-account (E4) — structuring payments decision.
- RGPD erasure vs fiscal retention (I1) — the carve-out must be designed before
  any deletion flow goes live; today neither side works (cron absent).
- Offline fiscal model (H4) — how an offline sale enters the chain safely (defer
  ticket-number + hash to sync under the lock? a separate offline-chain
  reconciled like the strate-II design?). Genuinely hard; today it forks.

## Completeness-audit note
Two findings exceed their prior framing and are elevated here:
- **Offline (H4)** was 🟠 "delicate" → it is 🔴 [M]: it forks the fiscal chain.
- **Attestation (L1)** is a concrete [M] legal deliverable, not a [S] nicety, for
  an NF525-defensible store.
No ratified decision was found resting on thin reasoning. The route-to-store 🔴
[M] list is the order driver — not SaaS exhaustiveness.
