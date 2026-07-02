/**
 * POS-121 / POS-123 — drift locks (NF525).
 *
 * POS-121 — a VALIDATED sale must never be mutated:
 *   (a) the sales REST surface exposes no PATCH/PUT/DELETE;
 *   (b) no runtime code issues raw `UPDATE sales` / `DELETE FROM sales`;
 *   (c) `save(SaleEntity` exists only at the 3 sanctioned sites
 *       (createSale, voidSale status-flip, sync insert-of-new) and the sync
 *       site provably filters out already-existing ids before saving.
 *   The behavioural half (void leaves the original hash/amounts intact) is
 *   proven by void-m4-journal-chain.spec.ts — this file locks the surface.
 *
 * POS-123 — the fiscal journal is append-only:
 *   no code path anywhere in src/ updates, deletes or removes fiscal_journal
 *   rows; only `insert(FiscalJournalEntity` (and SELECTs) are allowed.
 *
 * Style mirrors audit-hash-drift-guard / source-no-secrets: static source
 * locks that make silent regressions fail CI, complementing runtime tests.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '../src');

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.ts$/.test(e.name) && !/\.(spec|test)\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Runtime code only — migrations are versioned one-shots reviewed separately. */
const runtimeFiles = () =>
  walk(SRC).filter((f) => !f.includes(`${path.sep}migrations${path.sep}`));

const rel = (f: string) => path.relative(SRC, f);

describe('POS-121 — sale immutability surface lock', () => {
  it('sales controller exposes no PATCH/PUT/DELETE route', () => {
    const src = fs.readFileSync(
      path.join(SRC, 'modules/sales/sales.controller.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/@Patch\s*\(/);
    expect(src).not.toMatch(/@Put\s*\(/);
    expect(src).not.toMatch(/@Delete\s*\(/);
  });

  it('no runtime code issues raw UPDATE/DELETE on the sales table', () => {
    const offenders: string[] = [];
    for (const f of runtimeFiles()) {
      const src = fs.readFileSync(f, 'utf8');
      if (/\bUPDATE\s+sales\b/i.test(src) || /\bDELETE\s+FROM\s+sales\b/i.test(src)) {
        offenders.push(rel(f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no repository-level update/delete/remove on SaleEntity', () => {
    const offenders: string[] = [];
    for (const f of runtimeFiles()) {
      const src = fs.readFileSync(f, 'utf8');
      if (/(update|delete|remove|softDelete|softRemove)\s*\(\s*SaleEntity/.test(src)) {
        offenders.push(rel(f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('save(SaleEntity appears only at the sanctioned sites (create, void, sync-insert)', () => {
    const sites: string[] = [];
    for (const f of runtimeFiles()) {
      const src = fs.readFileSync(f, 'utf8');
      const count = (src.match(/save\s*\(\s*SaleEntity/g) || []).length;
      if (count > 0) sites.push(`${rel(f)}:${count}`);
    }
    sites.sort();
    expect(sites).toEqual([
      `${path.join('modules', 'sales', 'sales.service.ts')}:2`, // createSale + voidSale
      `${path.join('modules', 'sync', 'sync.service.ts')}:1`, // offline push (insert of new only)
    ]);
  });

  it('the sync save site provably inserts only NEW sales (existing ids filtered out)', () => {
    const src = fs.readFileSync(path.join(SRC, 'modules/sync/sync.service.ts'), 'utf8');
    // The dedup filter must sit in the same file as the save — if someone
    // removes the filter, this lock fails before a validated sale can be
    // silently overwritten by an offline replay.
    expect(src).toMatch(/!existingIds\.has\(/);
    expect(src).toMatch(/save\s*\(\s*SaleEntity/);
  });
});

describe('POS-123 — fiscal journal append-only lock', () => {
  it('no code path updates or deletes fiscal_journal rows (raw SQL)', () => {
    const offenders: string[] = [];
    for (const f of runtimeFiles()) {
      const src = fs.readFileSync(f, 'utf8');
      if (
        /\bUPDATE\s+fiscal_journal\b/i.test(src) ||
        /\bDELETE\s+FROM\s+fiscal_journal\b/i.test(src) ||
        /\bTRUNCATE\s+(TABLE\s+)?fiscal_journal\b/i.test(src)
      ) {
        offenders.push(rel(f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no repository-level update/delete/remove/save on FiscalJournalEntity — insert only', () => {
    const offenders: string[] = [];
    let inserts = 0;
    for (const f of runtimeFiles()) {
      const src = fs.readFileSync(f, 'utf8');
      if (/(update|delete|remove|softDelete|softRemove|save)\s*\(\s*FiscalJournalEntity/.test(src)) {
        offenders.push(rel(f));
      }
      inserts += (src.match(/insert\s*\(\s*FiscalJournalEntity/g) || []).length;
    }
    expect(offenders).toEqual([]);
    // The journal is actually written somewhere (void path) — the lock must
    // not pass vacuously because the journal stopped being written at all.
    expect(inserts).toBeGreaterThanOrEqual(1);
  });
});
