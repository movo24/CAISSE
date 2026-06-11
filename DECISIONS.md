# Architecture Decisions — CAISSE fiscal/POS

> **Append-only ADR log.** A superseded decision is *marked superseded*, never
> deleted — inalterability applied to our own architecture decisions. This file
> travels with the code (next to CLAUDE.md) so a future reader — you in six
> months, or another agent instance — finds the *why* and the *guarded
> invariant*, not just the *what* (the code already shows the what).
>
> **The load-bearing field is "Invariant guarded / breaks if undone."** On a
> fiscal system the real danger is not forgetting what was done — it's a future
> reader undoing a deliberate decision without knowing it was guarding an
> invariant. (e.g. "why is attribution a side-table? a column would be simpler"
> → and structural non-authority silently dies.) Read that field before
> changing anything an entry covers.
>
> **Status:** `RATIFIED` (decided by the owner) · `OPEN` (specced, awaiting an
> owner decision) · `SUPERSEDED by ADR-NNN`.
>
> This log **transcribes** ratified decisions; it does not make or extend any.
> Where the act of writing surfaced a decision that was *implicit but never
> ratified*, it is recorded as `OPEN` and flagged — never filled in.

---

## Frozen sub-rules (in force, do not relitigate — see CLAUDE.md contract)

- Never declare NF525 validated.
- Append-only-compensatoire: never status-flip a fiscal record *as the
  authoritative act*; chain a compensating event. Soft-deactivate, never
  hard-delete.
- DB-level invariants (partial unique index) over check-then-insert (TOCTOU);
  map unique_violation `23505` → `409`.
- No fiscal-prod DB credentials in the agent's perimeter — even read-only.
- Never reveal secrets (DATABASE_URL password, full PIN hashes).

---

## ADR-001 — Void blocked on a realized cash leg
**Status:** RATIFIED · merged (PR #10, `9da752f`).
**Context:** `voidSale` was unbounded; void-after-cash was a backdoor to cash exfil.
**Decision:** `voidSale` refuses when `sale.payments` has a `cash` leg with
`amountMinorUnits > 0` (409). Keys on the *realized leg*, not on `sale.status`.
Reversal of a realized cash sale goes through `createReturn` (compensation).
**Invariant guarded / breaks if undone:** void = *erase* (the sale never
happened); a realized cash sale *did* happen → erasing it is a false
declaration. Undo → reopens cash exfil via void-after-cash. Keying on the leg
(not status) is **fail-safe**: future split-tender/layaway makes it over-block,
never under-block. The hashed-vs-exported operator is untouched.
**Out of scope (named):** void-after-card-settled (same NF525 obligation, PSP-
signal gated) → the "unified reversibility guard" follow-up (issue).

## ADR-002 — POS session is terminal-bound (γ)
**Status:** RATIFIED · merged (PR #11, `b6e755c`).
**Context:** D1 — /CAISSE targets shared-terminal retail (cashier + manager on
one register, hand-overs, multi-store). β (employee-bound) does not close the
shared-terminal mis-attribution; only γ (terminal-bound) does.
**Decision:** one active session per `(storeId, terminalId)`. `X-Terminal-Id`
header required at open. Invariant enforced by a **partial unique index** at the
DB level (`uq_pos_sessions_store_terminal_active ... WHERE is_active`), with the
service catch mapping `23505 → 409`. `findActive` keyed by terminal, not
employee.
**Invariant guarded / breaks if undone:** (a) the unique index, not check-then-
insert — two concurrent opens on the same terminal would otherwise both pass
and both insert (TOCTOU); the DB makes the loser fail atomically. (b) terminal-
keyed, not employee-keyed — an employee may hold sessions on several terminals;
a terminal can never have two. Undo to employee-keyed → reopens shared-terminal
mis-attribution.

## ADR-003 — POS terminal registry, store-scoped (1b first brick)
**Status:** RATIFIED · branch `feat/pos-terminal-registry` (`d1cc5a5`), awaiting merge.
**Context:** γ's `terminal_id` is free-text from `X-Terminal-Id` with no referent.
**Decision:** `pos_terminals` table (logical till, store-scoped, **distinct from
the Stripe payment-reader** `payment_terminals`). `validateClaim(store, code)`
returns the terminal iff active in the given store. Provision is privileged
(`@Roles('admin','manager')`, store from JWT). Soft-deactivate, never hard-
delete. Partial unique index on `(store_id, terminal_code) WHERE is_active`.
**Invariant guarded / breaks if undone:** `validateClaim` stops **cross-store**
spoofing (an operator scoped to store A cannot claim a store-B terminal). It is
**necessary, not sufficient** — it does NOT stop **intra-store** spoofing (claim
Caisse-2 vs Caisse-1 within the store); that is closed only by the device
credential (ADR-005 / v3). Undo → `X-Terminal-Id` is unvalidated free text again.

## ADR-004 — Operator attribution = dedicated side-table, option (i)
**Status:** RATIFIED · branch `feat/operator-annotation-binding` (`6458bf2`), awaiting merge.
**Context:** binding terminal→operator onto the sale touches `sale.employee_id`,
which **is in the v2 hash payload** → authoritative *by construction*. "Wired but
non-authoritative" is impossible if it lands in the hashed field.
**Decision:** record the session operator in a **separate `operator_attribution`
table** (insert-only, written in the event's own transaction), NOT in any column
of the 3 hashed tables (`sales`, `credit_notes`, `fiscal_journal`). The hashed/
exported `employee_id` stays the JWT value on every door. Divergence
(`employee_id` JWT vs `session_operator_id`) computed by join — no extra field.
**Invariant guarded / breaks if undone:** non-authority is **structural** — the
data is simply not on the hashed tables; an auditor sees a manifestly non-fiscal
table. `fiscal_journal` (append-only, most sacred) is untouched. Undo → moving
attribution to a column on `sales` puts the session operator adjacent to the
hashed fields, one SELECT from being treated as authoritative at an export edge,
and the v3 bascule loses its clean migration source. **Proof that must stay
green:** the hash recompute *ignores* the attribution (a sale whose session
operator ≠ JWT keeps `sale.employee_id = JWT`).

## ADR-005 — Attribution on all 3 corrective/sale doors; event-time correctness
**Status:** RATIFIED · same branch as ADR-004.
**Decision:** `createSale`, `voidSale`, `createReturn` all record attribution
from the **active session of the event's terminal at event time**. A return at
terminal B (operator B) on a sale made at terminal A is attributed to **B**,
never inherited from A. Same for void (the corrective door loads the original
sale, so the original operator is in scope — must NOT be used). `createSale`
carries no inheritance risk (it is the origin event).
**Invariant guarded / breaks if undone:** event-time correctness and non-
authority are **orthogonal** — proving one does not prove the other. Undo (wire
only some doors, or inherit the original operator on a corrective door) →
reintroduces the door asymmetry and mis-attributes corrections. **Proof that
must stay green:** #7 return-mirror AND #7 void-mirror (both terminals B→B,
never A).

## ADR-006 — Divergence metric is the v3-decision input
**Status:** RATIFIED.
**Decision:** option (i) is not "progress while waiting" — the JWT-vs-session
divergence (already computable from the row + its join) is the *measurement that
justifies or kills* the v3 bascule. Define what to watch before flipping:
converge-always → session adds nothing fiscal, v3 unneeded; diverge → measured
attribution gap before graving it into the chain.
**Invariant guarded / breaks if undone:** removing/ignoring the metric turns v3
into a blind decision on the immutable chain.

## ADR-007 — Operating-autonomy contract + fiscal gate
**Status:** RATIFIED · in CLAUDE.md (`014eae9`).
**Decision:** max autonomy on reversible work (feature branches, additive
migrations on greenfield, tests, diffs). Mandatory stop on: writes to main/prod,
fiscal attribution / journal chaining / NF525-authoritative changes, anything
irreversible once real transactions exist. **Doubt → treat as fiscal → stop.**
**Invariant guarded / breaks if undone:** the escalation classifier missing
(taking a fiscal decision for a routine one) is the one costly failure; the
"doubt → fiscal → stop" railing is what makes full autonomy safe everywhere else.

## ADR-008 — Backend deployment topology (corrected)
**Status:** RATIFIED · CLAUDE.md/RUNBOOK/DEPLOIEMENT-PLAN corrected on `feat/pos-terminal-registry`.
**Decision (by endpoint triangulation 2026-06-11):** `api.addxintelligence.com`
is the **one live CAISSE backend** (DNS cutover done); the Railway native URL
`caisse-backend-production.up.railway.app` is **dead (404)**. Deploys are
**manual** — merge to main is one human act, the Railway deploy a second.
Migration-applied proof = the `Migration … executed successfully` line in the
deploy logs, not an agent DB connection.
**Invariant guarded / breaks if undone:** a stale topology in CLAUDE.md is what
makes a model-error repeat ("Railway auto-deploys on merge" was false and was
propagated for a whole session). Health checks must target the live URL; the
dead native URL is an operational-risk target.

## ADR-009 — NF525 priority pivot: seal+complete the Z (A/B) before v3
**Status:** RATIFIED (priority) · A/B spec OPEN (see Open decisions).
**Context:** the audit found the Z-report (the closure) is a **mutable, non-
chained row** that **omits returns** — a hole bigger than the attribution work
in progress.
**Decision:** the next *fiscal build* after 1b is **B (returns in the total) +
A (seal the closure)**, coupled, **before** v3. Attribution hardens *who*
operates; a sealed+complete closure hardens *that the closure does not lie* —
for an NF525 auditor, the latter is primary.
**Invariant guarded / breaks if undone:** doing v3 first leaves the central
NF525 artifact (the clôture) falsifiable and incomplete. **Correct-before-seal**
(B before/with A): never grave an over-declared total into the inalterable.

## ADR-010 — Stripe card-present: a new collection door, not plumbing
**Status:** RATIFIED (the items below) · build OPEN, queued after A/B.
**Decision:** WisePad 3 (Bluetooth) → **React Native gateway app** (server-driven
and JS SDK are impossible for this reader). Model **β "sealed-at-auth"**: no
fiscal sale exists until Stripe authorizes; `createSale` seals at authorization
as `pending_capture`, → `completed` on capture, → `payment_capture_failed` on
failure. **Manual capture.** The **Stripe webhook
(`payment_intent.succeeded`/`.payment_failed`) is the authoritative resolver** —
the local status never decides an outcome Stripe owns; `pending_capture` is
transitory, reconciled against Stripe (Catch 1). `payment_capture_failed` =
status flip **+ a compensating `fiscal_journal` event** (like the void), manager/
HQ correction itself journaled. Reader (`stripe_reader_id`) **≠** logical
terminal (`pos_terminals`) — bound `reader↔store↔pos_terminal`, never fused
(form OPEN). Test-mode only in the agent perimeter; live keys + physical reader
+ go-live are human terrain.
**Invariant guarded / breaks if undone:**
- **Seal-then-capture** (not capture-then-seal): better a flagged sale-anomaly
  than captured-money-with-no-fiscal-trace (the cardinal NF525 sin). Undo →
  money can move against a non-sealed sale.
- **Webhook authoritative:** treating a lost/timed-out capture response as
  failure would mark a possibly-succeeded capture as failed → the exact
  money-vs-record mismatch. Undo → classic lost-capture / double-charge.
- **status is NOT in `saleDataForHash`** (proven: the void flips status while the
  sale hash is unchanged) → `payment_capture_failed`/`pending_capture` do not
  break the chain; the risk is lifecycle logic, not chain integrity. The
  anomaly's *authority* lives in the journal event, not the mutable status.
- **Reader ≠ logical terminal:** fusing them re-introduces the conflation that
  lets a register use another store's reader.
- **Driver behind a `PaymentPort` interface:** the fiscal layer sees only
  "request payment → confirmed/refused"; WisePad-3-now and S700-later substitute
  without touching the fiscal layer. The test hardware must not lock the prod
  architecture.

## ADR-011 — Session-open validation = (G)-sticky, fail-closed
**Status:** RATIFIED (the design) · build OPEN, after the registry merge + this choice.
**Context:** wiring `validateClaim` into session-open is a security control with
an availability stake — blocking session-open blocks the whole POS of a terminal.
**Decision:** **(G) graceful-but-sticky.** *mode* = "does this store have a
terminal **row**, active OR deactivated?" → if none, allow (transitional, annotate
`terminal_unverified`); if some exist, refuse a non-matching claim. *match* =
`validateClaim` (active only). The mode is derived from **row existence**, never
from the active count.
**Invariant guarded / breaks if undone:** deriving mode from *active count* is
**fail-open** — a store that provisions then deactivates all terminals would
re-accept any `X-Terminal-Id`; disabling the registry would *reopen* the door. A
security control must never fail-open via a routine op. Soft-deactivate keeps the
row, so the store stays in refuse-mode (sticky, fail-closed).
**v3 constraint (named):** `terminal_unverified` becomes a **gate input** at v3 —
a session on an unverified terminal must NEVER feed authoritative attribution,
or the transitional window leaks into the chain at the flip.

## ADR-012 — Z seal boundary = close-window keyed on the chain cursor (not the calendar, not wall-clock)
**Status:** RATIFIED (A/B + the boundary form below) · build OPEN, in layers.
Supersedes the "A/B spec OPEN" of ADR-009: **A-1** (seal the Z form, append-only
hash-chained), **A-2** (canonical verbatim payload, like `fiscal_journal`),
**A-4** (returns attributed at event time), **A-5** (perpetual grand total /
cumul perpétuel advanced at each close), **B-1** (gift-card / returns counted in
the closure) are now ratified.

**Context — the coupling found while closing H4 (see GAPS CORRECTION-2):** a
sealed Z is inalterable only if its *perimeter* is immutable — no sale may enter
an already-sealed window, or `sealed total ≠ recompute` and "verifiable vs the
sales chain" breaks. The Z today buckets by `DATE(s.created_at)`
(`reports.service.ts:35`), which is **not** an immutable perimeter:
- *early close* — manager closes at 18:00, store open till 20:00; the 18:00-20:00
  sales share the calendar day → they land in a sealed day;
- *post-midnight trade* — one trading night splits across two calendar Z.

**Decision — the perimeter is a close-window, keyed on the lock-serialized chain
cursor, not the clock.** A clôture is an *event*, not a midnight.
- The per-store monotonic cursor **already exists**: `ticket_number` is assigned
  `max+1` under the `stores FOR UPDATE` lock (`sales.service.ts:362-377`), and the
  hash chain's `prevHash` is read `ORDER BY ticket_number DESC LIMIT 1` (`:380-385`)
  → **the chain is ordered by `ticket_number`; it IS the cursor.**
- The close, under the **same** `stores FOR UPDATE` lock, snapshots
  `close_seq = max(ticket_number)` (as an **integer**). Window =
  `ticket_number ∈ (prev_close_seq, close_seq]`. The cursor only advances under
  the lock; the close reads it under the lock → every sale "before" is ≤ close_seq,
  every sale "after" is > close_seq. **Race-free by construction**, independent of
  any timestamp.
- `created_at`/`completedAt` become **informative** (display, analytics), never the
  fiscal boundary.

**Verified (the facts this rests on — not asserted):**
- `completedAt = new Date()` (`:398`) IS inside the locked section (FOR UPDATE at
  `:362`) → the "timestamp posed before the lock" race does not occur today; but
  wall-clock-under-lock is not guaranteed-monotonic (NTP) and is refactor-fragile
  → not used as the boundary.
- `ticket_number` is the lock-serialized monotonic per-store cursor the chain is
  already ordered by → used as the boundary.

**Coupled sub-rules (ratified into the spec, not deferred):**
- **online-only V1 is load-bearing for the seal**, not a convenience: it is what
  keeps the cursor/timestamps clean (no late offline insert into a sealed window).
  A third reason to keep it, beyond H4.
- **Daily-closure guarantee** — the window model needs a close *guaranteed each
  day* (auto-close at a store-TZ cutover, with a forced-close fallback on next
  activity if a window has spanned the cutover). Pure event-driven without forcing
  → a lazy operator yields a 3-day window = non-daily closure, which NF525 dislikes.
- **strate-II inheritance** — a re-sealed offline sale lands in the **open**
  window; if its real sale-time falls in an already-closed window, the re-seal is
  **refused or routed to an explicit écart**, never a mutation of a sealed window.
  The seal must account for it. (Carried so it is not lost when offline returns.)
- **verify-recompute is a standing command** (like `fiscal:verify`), not a
  one-shot test: `sum(sales where ticket_number ∈ window) == sealed total` for
  every sealed window, re-runnable for life — the "verifiable vs the sales chain"
  property as a permanent drift detector.

**Proposed shape (z_seals, mirrors `fiscal_journal` — append-only, hash-chained,
verbatim text payload):** per `(storeId, sequence)`: `prev_close_seq`,
`close_seq` (int), the window aggregate (revenue, tax, count, by-tender, returns),
the perpetual grand total after close, `payload` (canonical text, hashed),
`hash_chain_prev`/`hash_chain_current` (a Z-chain parallel to the sales chain).
Never updated/deleted.

**Found during verification (latent, separate fix):** `ticket_number` is a
zero-padded string `T-000006`; `ORDER BY ticket_number DESC` is numeric only to 6
digits → at 1,000,000 sales/store the ticket generator and `prevHash` lookup break
(dup tickets + chain fork). The seal sidesteps it by keying on the parsed integer,
but the **ticket generator itself needs a separate fix** (cast-to-int ordering or a
dedicated sequence column). Fiscal (chain fork at scale), off the seal's path.

**Invariant guarded / breaks if undone:**
- **Boundary on the chain cursor, not the clock** — keying the window on
  `created_at`/wall-clock re-introduces the race (a stamp posed before the lock, or
  an NTP backward jump, drops a sale into a sealed window) → `sealed total ≠
  recompute`. The cursor is monotone *because* it only moves under the lock; that is
  the property the seal must inherit, not borrow from the clock.
- **Same lock as the chain (M5)** — the close must take the per-store `FOR UPDATE`
  to snapshot `close_seq` atomically; under a different lock (or none) a sale can
  commit between snapshot and seal → boundary leak.
- **Daily-closure guarantee** — without it the model is correct but produces
  non-journalière closures; NF525 wants the periodicity.
- **Correct-before-seal (B with A, from ADR-009)** — returns enter the total
  *before* the window is graved, never after.

## OPEN decisions (specced, awaiting the owner — not ratified, not filled)

- **A/B-1** — gift-card *issuance* in the Z: liability (separate line, excluded
  from net revenue) vs other. *Reco: separate liability.* OPEN.
- **A/B-2** — Z seal form: hash chain on `z_reports` (reco) / `fiscal_journal`
  mirror per Z / both. OPEN.
- **A/B-3** — Z hashed payload: canonical verbatim (reco, for authoritative
  recompute). OPEN.
- **A/B-4** — returns imputed at **event-time** (the return's own date, not the
  original sale's; mirror of #7). *Reco: yes.* OPEN (confirm).
- **A/B-5** — Z perpetual grand total (`cumulative_*`, never reset) does NOT
  exist today (confirmed by entity audit). Sealing must add it, chained Z→Z.
  Form OPEN.
- **Stripe-1** — gateway app form (RN reco), capture (manual RATIFIED), sealing
  (β sealed-at-auth RATIFIED), cleanup/idempotency (PI + sale idempotency,
  webhook-replay safe) OPEN, `reader↔store↔pos_terminal` mapping **form** OPEN
  (principle ratified: bind, never fuse).
- **issueGiftCard as a 4th attribution door** — value-moving, chained, operator
  stored-not-hashed, no (1b) attribution. Treat like the other doors, or declare
  out. OPEN (parked to the audit — *implicit-but-never-ratified*, flagged).
- **D — cash drawer reconciliation** — does NOT exist. The detective-tier cash
  control (theoretical-vs-counted cash, variance = skim signal). Biggest
  remaining sub-system; queued behind A/B. OPEN.
- **v3 bascule** — operator into the hash, gated on a per-terminal device
  credential + the `terminal_unverified` gate (ADR-011). Future, gated. OPEN.
- **Sister-of-#7** — at v3, the return operator must *enter* `chainPayload` for
  the first time (sale & void operators are already hashed; the credit_note
  operator is not → 2-hashed-vs-1 asymmetry). A v3 pass touching only sales would
  leave a refund operator alterable post-hoc. OPEN.
- **Authoritative recompute for sales/credit_notes** — store a canonical verbatim
  payload (like `fiscal_journal`) so the verifier is authoritative, not best-
  effort. Noted in DEPLOIEMENT-PLAN as remaining NF525 work. OPEN.

---

## Completeness-audit notes (side effect of writing this log)

Writing this surfaced **one implicit-but-never-ratified decision**, flagged
above, not filled:
- **issueGiftCard's attribution/audit class** was *parked* ("leave to the
  audit"), which is not a ratification of how the door is treated. Recorded
  OPEN. Surfaced to the owner, not decided here.

No ratified decision was found to rest on thin reasoning. The two governance
docs (CLAUDE.md operating contract, this log) and the GitHub issues (#4–#9 +
the two NF525 issues A/B) are the durable homes; this log is the *why*.
