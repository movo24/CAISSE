# Payment & fiscal security invariants (mandatory)

Non-negotiable invariants for any code touching payments, subscriptions, billing, or the
fiscal chain. Violations are critical bugs — fix them via the continuity charter's
critical-bug sequence (tests-as-spec → fix in branch → verify → commit).

## Capture invariant
- **No `status='active'`, no paid plan, no full entitlement without a confirmed, captured payment.**
- A POS card payment is not "paid" until really captured (offline/partial card → sale may
  continue but stays `payment_pending`, never falsely completed).
- Stripe: activate ONLY on a verified webhook event with `payment_status === 'paid'`. Never
  trust client-controlled `metadata` for the paid decision.
- Reconcile **amount + currency + plan** against the catalog before activating. A mismatch
  must NOT grant the plan.
- Local "change plan" endpoints must not grant a paid plan directly — paid activation comes
  only from the verified-paid webhook path.

## Authorization (RBAC)
- `RolesGuard` is **fail-open**: a route with `RolesGuard` but no `@Roles(...)` allows any
  authenticated user. Every sensitive/billing route MUST carry an explicit `@Roles('admin')`
  (change-plan, cancel, trial, checkout, portal, …).
- Verify tenant/ownership of `:storeId` for store-scoped billing routes.

## Webhook robustness
- Verify the signature before any state change; reject when the webhook secret is unset.
- Idempotency must be **durable** (persisted, survives restart / multi-instance) — never an
  in-memory `Set`. Persist the processed-event key only **after** the handler succeeds, so a
  failed handler is retried by the provider rather than silently skipped.

## Discounts / fiscal
- Manual discount cap 30% (`discount / subtotal ≤ 0.30`), server-enforced via responsible code.
- Money rounding is **half-up to the nearest minor unit** everywhere (matches the fiscal
  chain: tax, discounts, refunds). Use exact integer/BigInt arithmetic for conversions — never
  float64 for money (it mis-rounds large amounts).
- `fiscal_journal` is in-band, fail-closed (NF525). `AuditService` is out-of-band best-effort.

## Testing payment code
- Always mock the payment provider (Stripe client injected) — never hit the live API, never a
  real payment, in tests.
- Write the invariant tests first; several will be RED on buggy code — that documents the violation.
