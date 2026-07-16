#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires -- script CLI Node autonome (CommonJS) */
/**
 * stock-reconcile.js — instrument de réconciliation LECTURE SEULE (double-run F1→F3).
 *
 * Rapporte, par (magasin, produit) : `scalar_stock` (products.stock_quantity, lu par la caisse)
 * vs `journal_sum` (somme SIGNÉE des mouvements de liaison vente : sale/pack_consumption = −qty ;
 * return_customer/void = +qty ; inventory_adjust = +qty signé), et le `gap = scalar − journal_sum`.
 *
 * PROPRIÉTÉ (cf. stock-reconciliation-readonly.pg.spec.ts) : tant que seuls des chemins
 * journalisés tournent, `gap` reste CONSTANT (= le solde d'ouverture implicite). Toute VARIATION
 * du gap (delta vs une mesure précédente) = effet d'un chemin NON journalisé (aujourd'hui : le
 * système B legacy `syncLegacyStock`, ou une correction manuelle en base). C'est le signal de
 * pilotage du double-run : critère de bascule F3 = 0 variation de gap inexpliquée.
 *
 * LECTURE SEULE STRICTE : la requête tourne dans `BEGIN TRANSACTION READ ONLY` — toute écriture
 * échouerait. Aucune écriture base, aucun DDL, aucun chemin fiscal. La seule I/O disque est le
 * fichier de snapshot LOCAL (--snapshot / --baseline), jamais la base.
 *
 * Usage :
 *   node scripts/stock-reconcile.js --url postgres://… [--store <uuid>]
 *        [--baseline prev.json] [--snapshot cur.json] [--threshold 0] [--json]
 *   (à défaut de --url : variable d'env DATABASE_URL)
 *
 * Codes retour : 0 = OK (aucune variation de gap > seuil, ou pas de baseline) ;
 *                2 = variation(s) de gap détectée(s) vs baseline (à investiguer) ;
 *                1 = erreur (connexion, arguments…).
 */
const fs = require('fs');
const { Client } = require('pg');

function parseArgs(argv) {
  const a = { threshold: 0, json: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--json') a.json = true;
    else if (k === '--url') a.url = argv[++i];
    else if (k === '--store') a.store = argv[++i];
    else if (k === '--baseline') a.baseline = argv[++i];
    else if (k === '--snapshot') a.snapshot = argv[++i];
    else if (k === '--threshold') a.threshold = Number(argv[++i]);
    else { console.error(`Argument inconnu : ${k}`); process.exit(1); }
  }
  a.url = a.url || process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (!a.url) { console.error('Fournir --url ou DATABASE_URL.'); process.exit(1); }
  return a;
}

const RECONCILE_SQL = `
  SELECT p.store_id::text AS store_id, p.id::text AS product_id, p.name, p.ean,
         p.stock_quantity::int AS scalar_stock,
         COALESCE(j.journal_sum, 0)::int AS journal_sum,
         (p.stock_quantity - COALESCE(j.journal_sum, 0))::int AS gap
  FROM products p
  LEFT JOIN (
    SELECT store_id, product_id,
      SUM(CASE movement_type
            WHEN 'sale' THEN -quantity
            WHEN 'pack_consumption' THEN -quantity
            WHEN 'return_customer' THEN quantity
            WHEN 'void' THEN quantity
            WHEN 'inventory_adjust' THEN quantity
            ELSE 0 END)::int AS journal_sum
    FROM stock_movements
    WHERE store_id IS NOT NULL
    GROUP BY store_id, product_id
  ) j ON j.store_id::text = p.store_id::text AND j.product_id::text = p.id::text
  WHERE ($1::text IS NULL OR p.store_id::text = $1::text)
  ORDER BY p.store_id, p.name`;

async function main() {
  const args = parseArgs(process.argv);
  const client = new Client({ connectionString: args.url });
  await client.connect();
  let rows;
  try {
    // Lecture seule imposée au niveau base : toute écriture accidentelle échoue.
    await client.query('BEGIN TRANSACTION READ ONLY');
    rows = (await client.query(RECONCILE_SQL, [args.store || null])).rows;
    await client.query('COMMIT');
  } finally {
    await client.end();
  }

  const baseline = args.baseline && fs.existsSync(args.baseline)
    ? JSON.parse(fs.readFileSync(args.baseline, 'utf8'))
    : null;
  const baseGap = new Map((baseline?.rows || []).map((r) => [`${r.store_id}:${r.product_id}`, r.gap]));

  const report = rows.map((r) => {
    const prev = baseGap.has(`${r.store_id}:${r.product_id}`) ? baseGap.get(`${r.store_id}:${r.product_id}`) : null;
    return { ...r, gap_delta: prev === null ? null : r.gap - prev };
  });
  const drift = report.filter((r) => r.gap_delta !== null && Math.abs(r.gap_delta) > args.threshold);

  if (args.snapshot) {
    fs.writeFileSync(args.snapshot, JSON.stringify({ at: new Date().toISOString(), rows: report }, null, 2));
  }

  if (args.json) {
    console.log(JSON.stringify({ store: args.store || 'ALL', products: report.length, drift: drift.length, threshold: args.threshold, report }, null, 2));
  } else {
    console.log(`Réconciliation stock — ${report.length} produit(s)${args.store ? ` (magasin ${args.store})` : ' (tous magasins)'}`);
    console.log('  scalar  journal  gap   Δgap  produit');
    for (const r of report) {
      const d = r.gap_delta === null ? '   —' : (r.gap_delta > 0 ? '+' : '') + r.gap_delta;
      const flag = r.gap_delta !== null && Math.abs(r.gap_delta) > args.threshold ? '  ⚠ NON JOURNALISÉ' : '';
      console.log(`  ${String(r.scalar_stock).padStart(6)} ${String(r.journal_sum).padStart(7)} ${String(r.gap).padStart(5)} ${String(d).padStart(5)}  ${r.name}${flag}`);
    }
    console.log(baseline
      ? `\nVariations de gap > seuil(${args.threshold}) : ${drift.length}  → ${drift.length === 0 ? 'OK (aucun chemin non journalisé)' : 'À INVESTIGUER (legacy système B / correction manuelle)'}`
      : `\n(pas de baseline — mesure de référence ; relancer avec --baseline pour détecter les variations)`);
  }
  process.exit(drift.length > 0 ? 2 : 0);
}

main().catch((e) => { console.error('Erreur:', e.message); process.exit(1); });
