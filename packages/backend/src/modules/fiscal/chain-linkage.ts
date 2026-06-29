/**
 * POS — Fiscal hash-chain linkage check (pure, unit-testable). NF525.
 * Extracted from FiscalVerifyService.checkLinkage (behavior-preserving):
 * walks a per-store chain by hash pointers and reports forks, missing/multiple
 * genesis, orphans, and rows unreachable from genesis.
 */

export const GENESIS = '0'.repeat(64);

export interface ChainIssue {
  kind:
    | 'fork'
    | 'orphan'
    | 'unreachable'
    | 'multiple_genesis'
    | 'no_genesis'
    | 'hash_mismatch';
  detail: string;
}

/** Verify chain linkage by hash pointers (order-independent). */
export function checkChainLinkage(
  rows: { prev: string; current: string }[],
  genesis: string = GENESIS,
): { ok: boolean; issues: ChainIssue[] } {
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
  const genesisCount = rows.filter((r) => r.prev === genesis).length;
  if (genesisCount === 0) issues.push({ kind: 'no_genesis', detail: 'no row chains on genesis' });
  if (genesisCount > 1) issues.push({ kind: 'multiple_genesis', detail: `${genesisCount} rows chain on genesis` });
  // orphans: prev points to a hash that is not genesis and not any row's current
  for (const r of rows) {
    if (r.prev !== genesis && !currents.has(r.prev)) {
      issues.push({ kind: 'orphan', detail: `row current=${r.current.slice(0, 12)}… has prev not found in chain` });
    }
  }
  // reachability: walk from genesis following pointers
  const byPrevRow = new Map<string, { prev: string; current: string }>();
  for (const r of rows) if (!byPrevRow.has(r.prev)) byPrevRow.set(r.prev, r);
  let cursor = genesis;
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
