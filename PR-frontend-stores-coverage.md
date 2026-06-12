# PR — frontend store coverage (posStore + performanceStore)

Adds pure-logic vitest coverage for `posStore` (cart math/mutations) and
`performanceStore` (metrics accumulation/projections), asserting the stores' REAL
behaviour. No business change, no refactor.

## ⚠️ Two business ambiguities were surfaced (NOT invented) and parked as `it.todo`

They have since been **ratified and fixed** in the sibling PR
**`fix/frontend-store-business-rules`** (RED→GREEN, surgical). When that PR is on
`main`, the two `it.todo` markers in this branch become resolved and must be removed
so the knowledge does not rot:

- [x] **posStore** — `it.todo` removed (was `posStore.test.ts:177`).
  **Resolved by** RULE 1 — `total() = Math.max(0, subtotal − totalDiscount)` (never
  negative). The paired old-behaviour assertion (`total() === -300`) was removed too,
  since it would fail once the invariants PR is on main; the firm invariant lives in
  `posStore.invariants.test.ts` on `fix/frontend-store-business-rules`.

- [x] **performanceStore** — `it.todo` removed (was `performanceStore.test.ts:179`).
  **Resolved by** RULE 2 — `recordVoid` no-ops on an unknown ticket. The paired
  old-behaviour assertion (voidCount increments on an unknown ticket) was removed too,
  for the same reason; the firm invariant lives in
  `performanceStore.invariants.test.ts` on `fix/frontend-store-business-rules`.

## Suggested merge order
1. `fix/frontend-store-business-rules` (the two invariants + fixes) → `main`.
2. **this** PR (coverage) → `main`, **removing the two `it.todo` above** in the same
   PR (they are now decided).
3. `feat/pos-modules-2026-05` (debt doc + staffing/safeErrorMessage tests) → `main`.

> Both ambiguities are tracked as fiscal/UX-safe per the downstream-flow audit:
> `posStore` totals are **display/UX + local history + metrics only** (the NF525
> total is recomputed backend-side from items+payments), and the metrics
> `recordVoid` path is currently unwired (defensive). See the fix PR + the audit
> notes in the session report.
