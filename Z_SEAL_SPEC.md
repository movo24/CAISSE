# Z-seal — design spec (layers 1–3 + daily-closure)

> **DESIGN ONLY — reviewable, no table built.** Written in parallel with the
> couche-0 Neon dry-run (ADR-012 + AMENDMENT-1). The seal is built on the three
> cursors couche 0 lands (`sale_seq`, `credit_note_seq`, `journal_seq`) — it must
> NOT be built on assumed cursors. Review this, then on a clean dry-run + couche-0
> merge, layer 1 starts on confirmed cursors.

## What the seal must guarantee (recap of the ratified invariants)
- **Boundary = close-window keyed on the lock-serialized chain cursors**, never the
  clock (ADR-012). A sealed window is immutable because every new sale/return/void
  gets a cursor strictly greater than the snapshot taken under the store lock.
- **Three cursors, one lock** — sales / credit_notes / fiscal_journal each bordered
  by their own monotonic seq, all snapshot under the **same** `stores FOR UPDATE`.
- **Status-aware ventilation**, not a flat total (B+A enumeration).
- **Perpetual grand total** (A-5) advances by the net at each close.
- **Closing operator = side-table door, NOT hashed** (#3) — uniform with
  sale/void/return, flips to authoritative at v3 with the device-credential.
- **Correct-before-seal** — returns/voids enter the window before it is graved.

---

## Layer 1 — `z_seals` table (append-only, hash-chained)

One row per store closure. Append-only; never updated/deleted. The Z-chain runs
**parallel** to the three chains it seals, headed on `close_number`.

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `store_id` | uuid | |
| `close_number` | bigint | per-store monotonic closure cursor (the Z-chain head) |
| `opened_at` | timestamptz | informative — start of the window (prev close time) |
| `closed_at` | timestamptz | informative — when this close ran |
| `business_day` | date | informative label; the boundary is the cursors, not this |
| `sales_seq_from` / `sales_seq_to` | bigint | window `(from, to]` on `sale_seq` |
| `credit_note_seq_from` / `_to` | bigint | window on `credit_note_seq` |
| `journal_seq_from` / `_to` | bigint | window on `journal_seq` |
| `ca_brut_minor` | bigint | completed sales in the window (centimes) |
| `annulations_minor` | bigint | voids in the window (event-time, by journal_seq) |
| `retours_minor` | bigint | credit_notes (returns) in the window |
| `net_minor` | bigint | `ca_brut − retours` (voids already excluded from CA) |
| `by_tender` | jsonb | `{cash, card, voucher, gift_card, store_credit}` minor |
| `by_tax_rate` | jsonb | `{ "20": …, "10": …, "5.5": … }` minor |
| `cumul_perpetuel_minor` | bigint | running grand total after this close (monotone) |
| `payload` | text | canonical verbatim JSON of the sealed fields (hashed) |
| `hash_chain_prev` | varchar(64) | prev z_seal's current, or genesis `'0'×64` |
| `hash_chain_current` | varchar(64) | `sha256(prev + payload)` |
| `created_at` | timestamptz | |

- **Indexes:** PK `id`; unique `(store_id, close_number)`; index `(store_id, closed_at)`.
- **No operator column** — per #3 the closing operator is recorded in
  `operator_attribution` (a new `'close'` door, `eventId = z_seals.id`), insert-only,
  inside the close transaction, NOT hashed.
- **`payload`** is `text` (not jsonb) and stored verbatim, like `fiscal_journal` —
  jsonb reorders keys and breaks byte-for-byte re-verification.

## Layer 2 — the close transaction (NF525-authoritative — surfaced before merge)

Under one transaction:

1. **`SELECT id FROM stores WHERE id = $1 FOR UPDATE`** — the SAME lock the three
   chains write under. This makes the boundary atomic: a sale/return/void either
   commits before the close (inside the window) or after (next window), never astride.
2. **Read prev close** — `z_seals WHERE store_id ORDER BY close_number DESC LIMIT 1`
   → `prev_close_number`, the three `_to` cursors (= this window's `_from`), the
   prev `cumul_perpetuel`, the prev `hash_chain_current`. Genesis on first close
   (`_from = 0`, cumul 0, prev hash `'0'×64`).
3. **Snapshot the three heads under the lock** — `MAX(sale_seq)`, `MAX(credit_note_seq)`,
   `MAX(journal_seq)` for the store → the three `_to` cursors (integers).
4. **Aggregate the window, status-aware** — per chain, rows with `seq ∈ (from, to]`:
   - `ca_brut` = Σ completed sales; `by_tender`, `by_tax_rate` from their payments/lines;
   - `annulations` = Σ void events in the journal window (event-time: a void of a
     prior-window sale belongs to THIS window — it is a movement now);
   - `retours` = Σ credit_notes in the window; `net = ca_brut − retours`.
5. **`cumul_perpetuel = prev_cumul + net`** (monotone).
6. **Canonical payload** — sorted-key JSON of: store, close_number, the three
   `(from,to]`, ventilation, by_tender, by_tax_rate, cumul. `hash = sha256(prev + payload)`.
7. **Insert** the `z_seal` (append-only) + the `operator_attribution` `'close'` row.
8. **Commit.**

**Idempotency / once-only:** a re-issued close for the same `(store, business_day)`
or a replayed request must not double-seal — guard on a closure idempotency key
+ the `(store_id, close_number)` unique index (23505 → replay the existing seal).

## Layer 3 — `fiscal:verify-z` (standing drift detector, not a one-shot test)

A permanent command (like `fiscal:verify`), re-runnable for life — this is the
"verifiable vs the chains" property:

- For every `z_seal`: recompute the window from the three chains by `seq ∈ (from,to]`,
  assert `ca_brut / annulations / retours / net / by_tender / cumul` match the sealed
  values, and `sha256(prev + payload) == hash_chain_current`, and the Z-chain links
  (`prev == previous z_seal.current`).
- **Carries the sales walk-audit** moved here from couche 0 (the migration backfilled
  sales by ticket suffix, not by walk; verify-z re-walks all three chains structurally
  — the deep audit the migration's structural walk did once, now standing).
- Scope here is the FULL recompute (payload + structure), deeper than the migration's
  structural-only walk.

## Daily-closure guarantee (after layer 3)
The window model needs a close *guaranteed each day* (else a lazy operator yields a
3-day window = non-journalière, which NF525 dislikes): a scheduled auto-close at a
store-TZ cutover, with a forced-close fallback on next activity if a window has
spanned the cutover. Design TBD with the business-day decision below.

## OPEN for your review (before layer 1 is built)
1. **`by_tender` / `by_tax_rate` granularity** — jsonb (flexible, as drafted) vs typed
   columns (queryable, rigid). Lean: jsonb in the payload + a couple of hot columns.
2. **Business-day definition** — calendar day in store TZ vs a configurable cutover
   (bars/late-night trade past midnight). The cursors make the seal correct either way;
   this only sets the `business_day` *label* and the auto-close timing.
3. **Annulations of prior-window sales** — confirmed counted in THIS window (event-time,
   bordered by `journal_seq`). Flagging it explicitly so the ventilation semantics are
   ratified, not assumed.
4. **`issueGiftCard`** — gift-card issuance is value-moving; is it a ventilation line
   (and the 4th attribution door)? Orthogonal OPEN (ADR-012 OPEN set), does not block
   the seal but the ventilation must decide whether to show it.

---
*Build order: couche 0 (cursors, dry-run'd) → layer 1 (this table) → layer 2 (close)
→ layer 3 (verify-z) → daily-closure. Each: branch, tests, surfaced; merge is the
owner's click. Layer 2 is NF525-authoritative — surfaced before any merge.*
