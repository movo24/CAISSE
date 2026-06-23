# MobileAuth — token revocation: violation + fix design

> Prepared 2026-06-23. Branch `fix/mobile-auth-revocation-2026-06`.
> Audience isolation is already enforced and now pinned by `test/mobile-auth-audience.spec.ts`.
> This doc covers the remaining VIOLATED invariant: **no server-side token revocation.**

## The violation (confirmed in source)
- `logout` is a no-op (`mobile-auth.controller.ts:52-57`): pure client-side token discard.
- No `jti` denylist / `tokenVersion` anywhere; `MobileAuthGuard` (`common/guards/mobile-auth.guard.ts`) verifies the JWT signature + `aud` and trusts `payload.sub` with **no DB lookup**.
- Consequence: a leaked **access** token is valid for its full 15m and a **refresh** token for 30d, with no kill switch. `deleteMe` sets `deleted_at` (`mobile-auth.service.ts:139-145`) which blocks *future refresh* (refresh filters `deletedAt IsNull`) but does **not** invalidate an already-issued access token — the guard never checks the DB, so a soft-deleted customer's outstanding access token keeps working until expiry.

## Secure default (chosen)
`tokenVersion` on the customer, asserted by the guard on every request. Logout / soft-delete / (future) password-reset bump the version, instantly invalidating every previously-issued token. Chosen over a `jti` denylist because it needs no per-token storage/GC and one integer covers all of a customer's tokens.

## Implementation plan
1. **Entity** — `CustomerEntity.tokenVersion` `@Column({ name: 'token_version', type: 'int', default: 0 })`.
2. **Migration** — additive `ALTER TABLE customers ADD COLUMN token_version int NOT NULL DEFAULT 0` (reversible: drop column; no data change).
3. **Token issuance** (`buildAuthResponse`) — add `tv: customer.tokenVersion` to both access + refresh payloads.
4. **Guard** (`MobileAuthGuard`) — becomes **async + DI**: inject `Repository<CustomerEntity>`, after signature/aud verification look up the customer by `payload.sub`, reject if missing, `deletedAt != null`, or `customer.tokenVersion !== payload.tv`. Then set `req.customer`.
5. **Service** — `logout(customerId)` increments `tokenVersion` (no longer a no-op); `deleteMe` increments `tokenVersion` alongside `deletedAt`; `refresh` additionally checks `tv`.
6. **Tests** — after logout / deleteMe, a previously valid access token is rejected by the guard (RED on current code); a fresh login after a bump works; refresh with a stale `tv` is rejected.

## Blast radius (why this is a careful, standalone pass — not a tail-of-turn change)
`MobileAuthGuard` is **shared by 3 controllers**: `mobile-auth`, `coupon` (`coupon.controller.ts:14`), `loyalty-card` (`loyalty-card.controller.ts:15`). Turning it into a DI/async guard means **every** module that mounts it must resolve `CustomerEntity` for the guard. So the change must:
- add `CustomerEntity` to `TypeOrmModule.forFeature` in `coupon.module` and `loyalty-card.module` (mobile-auth already has it), OR register `MobileAuthGuard` as a shared provider in a module those import;
- be verified against the coupon + loyalty-card controllers' auth (regression risk: breaking those guards locks customers out of coupons/loyalty).

A broken shared auth guard is a real regression; this is implemented and verified as its own focused pass (guard change + migration + 3-module DI + the revocation tests + a full-suite run), not squeezed into an already-large turn.

## Status
- ✅ Audience isolation: enforced + pinned (`mobile-auth-audience.spec.ts`, 6/6).
- ◻️ Revocation: designed (this doc); implementation is the next pass.
