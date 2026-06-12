# DEBT.md — named technical/fiscal debts

> Append-only register of **deliberately deferred** work. A debt here is a
> conscious, scoped gap — not a bug and not a TODO. Each entry names *what is not
> covered*, *why it was deferred*, and *what closes it*. Nothing here should
> "disappear silently": closing a debt means a PR that removes its entry.

---

## D1 — Fiscal reversal of a **cash** sale via `createReturn` is not covered

**Status:** OPEN · named debt · owner-scoped to a separate fiscal-design PR.
**Since:** void-cash-realized guard (#10), reaffirmed 2026-06-12.

**Context.** The `void-cash-realized` guard (`sales.service.ts`, ~L933+) refuses to
`void` a sale that carries a *realized* cash leg (`payments.some(p => p.method ===
'cash' && p.amountMinorUnits > 0)`). Rationale: a cash sale physically happened;
its cancellation must go through the **return** path (cash refund via
`createReturn`), never through `void` (which models "the sale never occurred").
The security hole (voiding away realized cash) is **closed now**.

**What is NOT carried (the debt).** The fiscal-chain / `fiscal_journal` behaviour of
the **`createReturn` cash-refund** path itself is **not yet tested**:
- M3 (avoir restoration) and M4 (journal chain) were exercised on `void`. When the
  guard landed, those fixtures were **transposed to tenders that preserve the
  assertion** rather than deleted:
  - **M3** (`avoir-m1-m3.spec.ts`) → `store_credit` (a `card`-only fixture would
    leave the avoir assertion empty);
  - **M4** (`void-m4-journal-chain.spec.ts`) → `card` (an allowed, chain-preserving
    tender).
- So today there is **no test** proving that a cash sale reversed via
  `createReturn` (cash refund) produces the correct fiscal-journal event / chain
  linkage / Z-report effect. The transposition kept M3/M4 green **on a different
  path** (non-cash), it did not cover the cash-return path.

**Why deferred, not fixed inline.** Covering it properly is a *design* question
(does a cash refund emit its own `fiscal_journal` event? how does it chain relative
to the original sale and to voids? how does it land in the Z status-aware
ventilation?), not a one-line fixture change. It belongs in a dedicated fiscal
design pass, not bolted onto the guard PR.

**What closes it.** A separate **fiscal-design PR** that:
1. specifies the cash-refund-via-`createReturn` fiscal semantics (journal event +
   chain + Z effect),
2. adds a `createReturn`-cash spec asserting that behaviour end-to-end,
3. removes this entry.

**Cross-refs.** `CLAUDE.md` → *Known Issues / Open Items*; code comment at
`packages/backend/src/modules/sales/sales.service.ts` (the "Cas net-zéro pré-nommé"
block); specs `void-cash-realized-guard.spec.ts`, `avoir-m1-m3.spec.ts`,
`void-m4-journal-chain.spec.ts`.
