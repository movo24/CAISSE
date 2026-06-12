import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';

const GENESIS = '0'.repeat(64);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ChainIssue {
  kind: 'fork' | 'orphan' | 'unreachable' | 'multiple_genesis' | 'no_genesis' | 'hash_mismatch';
  detail: string;
}

export interface ChainReport {
  chain: 'sales' | 'credit_notes' | 'fiscal_journal';
  storeId: string;
  rows: number;
  linkageOk: boolean;
  recomputeOk: boolean;
  recomputeAuthoritative: boolean; // false = best-effort (payload reconstructed, not stored verbatim)
  issues: ChainIssue[];
}

export interface VerifyReport {
  ok: boolean;
  generatedAt: string;
  chains: ChainReport[];
}

/**
 * Read-only fiscal chain verifier.
 *
 * Two independent checks per per-store chain:
 *  (A) Linkage — walk the chain by HASH POINTERS (hashChainPrev → hashChainCurrent)
 *      starting from genesis. Detects forks, orphans, deletions and insertions
 *      WITHOUT depending on row timestamps. Robust for all three chains.
 *  (B) Recompute — re-derive each row's hash and compare to the stored value.
 *      Authoritative for `fiscal_journal` (payload stored verbatim). Best-effort
 *      for `sales` / `credit_notes` (payload reconstructed from columns — order
 *      of lines/payments and timestamp precision can differ on a real DB; a
 *      mismatch here is a SIGNAL to investigate, not proof of tampering, until
 *      the canonical payload is persisted — see TODO at the bottom).
 *
 * Never writes. Safe to run against production (read-only queries).
 */
@Injectable()
export class FiscalVerifyService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async verify(storeId?: string): Promise<VerifyReport> {
    const stores = storeId ? [storeId] : await this.allStoreIds();
    const chains: ChainReport[] = [];
    for (const s of stores) {
      chains.push(await this.verifySales(s));
      chains.push(await this.verifyCreditNotes(s));
      chains.push(await this.verifyJournal(s));
    }
    return {
      ok: chains.every((c) => c.linkageOk && c.recomputeOk),
      generatedAt: new Date().toISOString(),
      chains,
    };
  }

  private async allStoreIds(): Promise<string[]> {
    const rows = await this.ds.query(`SELECT id FROM stores ORDER BY id`);
    return (Array.isArray(rows) ? rows : []).map((r: any) => r.id);
  }

  /** Walk the chain by hash pointers; report linkage issues. */
  private checkLinkage(rows: { prev: string; current: string }[]): { ok: boolean; issues: ChainIssue[] } {
    const issues: ChainIssue[] = [];
    if (rows.length === 0) return { ok: true, issues };

    const byPrev = new Map<string, number>();
    const currents = new Set<string>();
    for (const r of rows) {
      byPrev.set(r.prev, (byPrev.get(r.prev) ?? 0) + 1);
      currents.add(r.current);
    }
    // forks: any prev shared by >1 row (two events chained on the same parent)
    for (const [prev, n] of byPrev) {
      if (n > 1) issues.push({ kind: 'fork', detail: `${n} rows chain on prev=${prev.slice(0, 12)}…` });
    }
    // genesis count
    const genesisCount = rows.filter((r) => r.prev === GENESIS).length;
    if (genesisCount === 0) issues.push({ kind: 'no_genesis', detail: 'no row chains on genesis' });
    if (genesisCount > 1) issues.push({ kind: 'multiple_genesis', detail: `${genesisCount} rows chain on genesis` });
    // orphans: prev points to a hash that is not genesis and not any row's current
    for (const r of rows) {
      if (r.prev !== GENESIS && !currents.has(r.prev)) {
        issues.push({ kind: 'orphan', detail: `row current=${r.current.slice(0, 12)}… has prev not found in chain` });
      }
    }
    // reachability: walk from genesis following pointers
    const byPrevRow = new Map<string, { prev: string; current: string }>();
    for (const r of rows) if (!byPrevRow.has(r.prev)) byPrevRow.set(r.prev, r);
    let cursor = GENESIS;
    let seen = 0;
    const guard = rows.length + 1;
    while (byPrevRow.has(cursor) && seen <= guard) {
      const next = byPrevRow.get(cursor)!;
      cursor = next.current;
      seen++;
    }
    if (seen !== rows.length) {
      issues.push({ kind: 'unreachable', detail: `${rows.length - seen} row(s) not reachable from genesis` });
    }
    return { ok: issues.length === 0, issues };
  }

  // ── sales ────────────────────────────────────────────────────────────────
  private async verifySales(storeId: string): Promise<ChainReport> {
    // Order by the integer cursor (sale_seq), NULLS LAST so offline-synced sales
    // (client ticket, no seq) trail the online chain. Ordering by ticket_number
    // is lexical and mis-orders past 1,000,000 (T-1000000 < T-999999 as text);
    // linkage itself walks hash pointers and is order-independent, but the row
    // order shown for diagnostics must follow the same cursor as the generator.
    const sales = await this.ds.query(
      `SELECT id, store_id, employee_id, customer_id, subtotal_minor_units, discount_total_minor_units,
              tax_total_minor_units, total_minor_units, ticket_number, hash_chain_prev, hash_chain_current,
              hash_version, completed_at
         FROM sales WHERE store_id = $1 ORDER BY sale_seq ASC NULLS LAST, ticket_number ASC`,
      [storeId],
    );
    const rows: any[] = Array.isArray(sales) ? sales : [];
    const linkage = this.checkLinkage(rows.map((r) => ({ prev: r.hash_chain_prev ?? GENESIS, current: r.hash_chain_current })));

    const issues: ChainIssue[] = [...linkage.issues];
    let mismatches = 0;
    for (const s of rows) {
      const lines = await this.ds.query(
        `SELECT ean, quantity, line_total_minor_units FROM sale_line_items WHERE sale_id = $1 ORDER BY id ASC`,
        [s.id],
      );
      const items = (Array.isArray(lines) ? lines : []).map((li: any) => ({
        ean: li.ean, qty: li.quantity, total: li.line_total_minor_units,
      }));
      let payload: string;
      if (Number(s.hash_version) === 2) {
        const pays = await this.ds.query(
          `SELECT method, amount_minor_units FROM sale_payments WHERE sale_id = $1 ORDER BY id ASC`,
          [s.id],
        );
        payload = JSON.stringify({
          v: 2,
          ticketNumber: s.ticket_number,
          storeId: s.store_id,
          employeeId: s.employee_id,
          customerId: s.customer_id ?? null,
          subtotalMinorUnits: s.subtotal_minor_units,
          discountTotalMinorUnits: s.discount_total_minor_units,
          taxTotalMinorUnits: s.tax_total_minor_units,
          totalAfterDiscount: s.total_minor_units,
          payments: (Array.isArray(pays) ? pays : []).map((p: any) => ({ method: p.method, amount: p.amount_minor_units })),
          completedAt: new Date(s.completed_at).toISOString(),
          items,
        });
      } else {
        payload = JSON.stringify({
          ticketNumber: s.ticket_number,
          storeId: s.store_id,
          employeeId: s.employee_id,
          totalAfterDiscount: s.total_minor_units,
          items,
        });
      }
      if (sha256((s.hash_chain_prev ?? GENESIS) + payload) !== s.hash_chain_current) mismatches++;
    }
    if (mismatches > 0) issues.push({ kind: 'hash_mismatch', detail: `${mismatches}/${rows.length} sale hashes did not recompute (best-effort)` });

    return {
      chain: 'sales', storeId, rows: rows.length,
      linkageOk: linkage.ok, recomputeOk: mismatches === 0, recomputeAuthoritative: false, issues,
    };
  }

  // ── credit notes ───────────────────────────────────────────────────────────
  private async verifyCreditNotes(storeId: string): Promise<ChainReport> {
    const cns = await this.ds.query(
      `SELECT id, code, store_id, original_sale_id, total_minor_units, origin, hash_chain_prev, hash_chain_current
         FROM credit_notes WHERE store_id = $1 ORDER BY created_at ASC`,
      [storeId],
    );
    const rows: any[] = Array.isArray(cns) ? cns : [];
    const linkage = this.checkLinkage(rows.map((r) => ({ prev: r.hash_chain_prev ?? GENESIS, current: r.hash_chain_current })));
    const issues: ChainIssue[] = [...linkage.issues];

    let mismatches = 0;
    for (const cn of rows) {
      let payload: string;
      if (cn.origin === 'gift_card') {
        payload = JSON.stringify({ code: cn.code, storeId: cn.store_id, amount: cn.total_minor_units, origin: 'gift_card' });
      } else {
        const lines = await this.ds.query(
          `SELECT product_id, quantity, line_total_minor_units FROM credit_note_lines WHERE credit_note_id = $1 ORDER BY id ASC`,
          [cn.id],
        );
        payload = JSON.stringify({
          code: cn.code, storeId: cn.store_id, originalSaleId: cn.original_sale_id, total: cn.total_minor_units,
          lines: (Array.isArray(lines) ? lines : []).map((l: any) => ({ p: l.product_id, q: l.quantity, t: l.line_total_minor_units })),
        });
      }
      if (sha256((cn.hash_chain_prev ?? GENESIS) + payload) !== cn.hash_chain_current) mismatches++;
    }
    if (mismatches > 0) issues.push({ kind: 'hash_mismatch', detail: `${mismatches}/${rows.length} credit-note hashes did not recompute (best-effort)` });

    return {
      chain: 'credit_notes', storeId, rows: rows.length,
      linkageOk: linkage.ok, recomputeOk: mismatches === 0, recomputeAuthoritative: false, issues,
    };
  }

  // ── fiscal journal (authoritative: payload stored verbatim) ─────────────────
  private async verifyJournal(storeId: string): Promise<ChainReport> {
    const entries = await this.ds.query(
      `SELECT payload, hash_chain_prev, hash_chain_current FROM fiscal_journal
         WHERE store_id = $1 ORDER BY created_at ASC`,
      [storeId],
    );
    const rows: any[] = Array.isArray(entries) ? entries : [];
    const linkage = this.checkLinkage(rows.map((r) => ({ prev: r.hash_chain_prev ?? GENESIS, current: r.hash_chain_current })));
    const issues: ChainIssue[] = [...linkage.issues];

    let mismatches = 0;
    for (const e of rows) {
      if (sha256((e.hash_chain_prev ?? GENESIS) + e.payload) !== e.hash_chain_current) mismatches++;
    }
    if (mismatches > 0) issues.push({ kind: 'hash_mismatch', detail: `${mismatches}/${rows.length} journal hashes did not recompute` });

    return {
      chain: 'fiscal_journal', storeId, rows: rows.length,
      linkageOk: linkage.ok, recomputeOk: mismatches === 0, recomputeAuthoritative: true, issues,
    };
  }
}
