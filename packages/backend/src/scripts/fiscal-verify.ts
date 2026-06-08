/**
 * CLI fiscal chain verifier — `npm run fiscal:verify [storeId]`.
 *
 * Read-only. Connects to DATABASE_URL, walks the sales / credit-note / fiscal-
 * journal hash chains per store, prints a report and exits 1 on any problem.
 * Safe against production (only SELECTs). Never writes.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { FiscalVerifyService } from '../modules/fiscal/fiscal-verify.service';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const storeId = process.argv[2]; // optional

  // No entities needed — the verifier issues raw SELECTs only.
  const ds = new DataSource({
    type: 'postgres',
    url,
    entities: [],
    synchronize: false,
    ssl: /\bsslmode=require\b/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  await ds.initialize();
  try {
    const svc = new FiscalVerifyService(ds);
    const report = await svc.verify(storeId);

    console.log(`\nFiscal chain verification — ${report.generatedAt}`);
    console.log('='.repeat(60));
    for (const c of report.chains) {
      const status = c.linkageOk && c.recomputeOk ? 'OK ' : 'KO ';
      const auth = c.recomputeAuthoritative ? '' : ' (recompute=best-effort)';
      console.log(`[${status}] ${c.chain.padEnd(14)} store=${c.storeId.slice(0, 8)}… rows=${c.rows} linkage=${c.linkageOk ? 'ok' : 'BROKEN'} recompute=${c.recomputeOk ? 'ok' : 'MISMATCH'}${auth}`);
      for (const i of c.issues) console.log(`        ! ${i.kind}: ${i.detail}`);
    }
    console.log('='.repeat(60));
    console.log(report.ok ? '✅ All fiscal chains verified.' : '❌ Fiscal chain problems detected (see above).');
    process.exit(report.ok ? 0 : 1);
  } finally {
    await ds.destroy();
  }
}

main().catch((e) => {
  console.error('fiscal:verify failed:', e?.message ?? e);
  process.exit(2);
});
