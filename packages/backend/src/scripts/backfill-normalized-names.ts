/**
 * P309 (cycle F) — TD-066-LEGACY-BACKFILL : one-off backfill of
 * products.normalized_name using the REAL normalizeName() (accents folded),
 * for rows migrated by 1722 with the weaker lower(trim(name)) backfill.
 *
 * READ→FIX, idempotent, chunked, dry-run by default:
 *   npm run backfill:names            → DRY RUN (reports, writes nothing)
 *   BACKFILL_APPLY=true npm run backfill:names   → applies the fixes
 *
 * ⚠️ Exécution sur la base CIBLE = gated (DATABASE_URL + GO) — comme toute
 * intervention données. Le cœur (`planNormalizedNameBackfill`) est pur et
 * prouvé sur pg-mem (backfill-normalized-names.pgmem.spec.ts).
 * Conflict safety: if two legacy rows of the SAME store would collide once
 * accents are folded (e.g. "Café" / "Cafe"), the script REPORTS them and
 * skips the update (human arbitration required — no silent merge).
 */
import 'reflect-metadata';
import type { EntityManager } from 'typeorm';
import { normalizeName } from '../modules/products/name-normalize';

export interface BackfillPlan {
  toFix: Array<{ id: string; storeId: string; name: string; from: string | null; to: string }>;
  conflicts: Array<{ storeId: string; normalized: string; ids: string[] }>;
  alreadyCorrect: number;
}

/** Pure planning step: reads products, computes fixes + collision report. */
export async function planNormalizedNameBackfill(manager: EntityManager): Promise<BackfillPlan> {
  const rows: Array<{ id: string; store_id: string; name: string; normalized_name: string | null }> =
    await manager.query(`SELECT id, store_id, name, normalized_name FROM products`);

  const plan: BackfillPlan = { toFix: [], conflicts: [], alreadyCorrect: 0 };
  const byStoreNorm = new Map<string, string[]>();

  for (const r of rows) {
    const target = normalizeName(r.name);
    const key = `${r.store_id}|${target}`;
    byStoreNorm.set(key, [...(byStoreNorm.get(key) ?? []), r.id]);
    if (r.normalized_name === target) plan.alreadyCorrect++;
    else plan.toFix.push({ id: r.id, storeId: r.store_id, name: r.name, from: r.normalized_name, to: target });
  }

  const conflictKeys = new Set(
    [...byStoreNorm.entries()].filter(([, ids]) => ids.length > 1).map(([k]) => k),
  );
  for (const key of conflictKeys) {
    const [storeId, normalized] = key.split('|');
    plan.conflicts.push({ storeId, normalized, ids: byStoreNorm.get(key)! });
  }
  // never auto-fix rows involved in a collision — human decision required
  const conflictIds = new Set(plan.conflicts.flatMap((c) => c.ids));
  plan.toFix = plan.toFix.filter((f) => !conflictIds.has(f.id));
  return plan;
}

/** Apply step: chunked idempotent UPDATEs (only the planned, conflict-free rows). */
export async function applyNormalizedNameBackfill(
  manager: EntityManager,
  plan: BackfillPlan,
  chunkSize = 200,
): Promise<number> {
  let updated = 0;
  for (let i = 0; i < plan.toFix.length; i += chunkSize) {
    const chunk = plan.toFix.slice(i, i + chunkSize);
    for (const f of chunk) {
      await manager.query(`UPDATE products SET normalized_name = $1 WHERE id = $2`, [f.to, f.id]);
      updated++;
    }
  }
  return updated;
}

/* c8 ignore start — CLI wrapper (needs a real DATABASE_URL; gated) */
async function main(): Promise<void> {
  const { DataSource } = await import('typeorm');
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL required (gated — see RESUME_CHECKLIST §3).');
    process.exit(1);
  }
  const ds = new DataSource({ type: 'postgres', url, entities: [] });
  await ds.initialize();
  try {
    const plan = await planNormalizedNameBackfill(ds.manager);
    console.log(`already correct: ${plan.alreadyCorrect} | to fix: ${plan.toFix.length} | conflicts: ${plan.conflicts.length}`);
    for (const c of plan.conflicts) {
      console.log(`  ⚠️ COLLISION store=${c.storeId} normalized="${c.normalized}" ids=${c.ids.join(',')} — NON corrigé, arbitrage humain requis`);
    }
    if (process.env.BACKFILL_APPLY === 'true') {
      const n = await applyNormalizedNameBackfill(ds.manager, plan);
      console.log(`APPLIED: ${n} rows updated.`);
    } else {
      console.log('DRY RUN (set BACKFILL_APPLY=true to apply).');
    }
  } finally {
    await ds.destroy();
  }
}
if (require.main === module) void main();
/* c8 ignore stop */
