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

---

## D-ANALYTICS-1 — `GRANT SELECT ON SCHEMA analytics` to the mobile API's DB role is deferred

**Status:** OPEN · named debt · settle when the mobile API gets its own deployment / DB role.
**Since:** étage 0/1 (the `analytics` Postgres schema, 2026-06-12).

**Why the schema exists.** The cockpit read model lives in a dedicated Postgres schema
`analytics` (not a `public` prefix) precisely so the mobile API's DB role can be granted
exactly:
```sql
GRANT USAGE ON SCHEMA analytics;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO <mobile_api_role>;
```
…and **nothing else** — INV-1/INV-2 enforced at the **database** level (read-only by
construction, zero access to the source/transactional `public` tables).

**The debt.** The backend currently runs on a **single DB connection/role** that can
read/write everything. So the GRANT-scoped read-only role is **not yet in place** — the
read-only discipline is, for now, enforced **in code** (`ReadOnlyGuard` rejects non-GET;
`MobileReadService` reads only `analytics.*`), not at the DB level. Acceptable for now
(the code guards hold), but the DB grant is the stronger, structural seal.

**What closes it** (at the latest when the mobile API gets its own deployment / DB creds):
1. create a dedicated DB role for the mobile API;
2. `GRANT USAGE + SELECT ON SCHEMA analytics` (only) to it;
3. point the mobile API connection at that role;
4. remove this entry.

**Cross-ref:** migration `1723000000000-CreateAnalyticsProjection` (the schema),
`MobileReadApiModule` / `ReadOnlyGuard` (the code-level read-only seal).

---

## D-ALERTS-1 — `store_closed_late` evaluates a WALL-CLOCK threshold in UTC

**Status:** OPEN · named debt · **blocks étage-4 delivery of this rule** (not its étage-2 generation).
**Since:** étage 2, rule `store_closed_late` (2026-06-12).

**The problem.** The rule compares `now.getUTCHours()` to `close_hour_utc`. For a
French network this is NOT benign: a store closing at 20:00 LOCAL is 18:00 or 19:00
UTC depending on DST — a fixed UTC hour mis-fires by 1–2h twice a year, and the
"late" threshold is inherently a wall-clock concept. Greenfield keeps it inert today
(rule generates facts nobody is paged on), but **étage 4 must NOT deliver
`store_closed_late` until the store-timezone policy lands.**

**What closes it:**
1. a store-TZ policy (per-store timezone as DATA — registry/config, aligned with the
   business-day definition item the owner carries);
2. the rule evaluates the closing hour in STORE-LOCAL time;
3. remove this entry.

**Cross-ref:** `rules/store-closed-late.rule.ts` (caveat comment), the étage-0 UTC
business-day convention, the Z_SEAL_SPEC business-day OPEN.

*Addendum (étage-4 review, 2026-06-13) — DISPLAY question, to settle before real
sessions exist:* the freeze is DELIVERY-only, so `store_closed_late` facts remain
visible in `GET /mobile/v1/alerts` with the UTC stand-in's 1–2h imprecision.
Inert in greenfield. Owner decision pending (same resolution as the store-TZ
policy): either the DISPLAY also waits for the precise TZ, or the UTC stand-in is
a deliberately acceptable "coarse late" to show without pushing. Not coded yet.
