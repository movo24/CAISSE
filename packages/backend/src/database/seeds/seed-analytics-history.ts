/**
 * Seed DEV — historique de ventes + coûts produits pour rendre les modules
 * analytics (dashboard top/flop/dormants, performance, tendance CA) CRÉDIBLES.
 *
 * STRICTEMENT dev/local : insère des ventes fictives marquées ticketNumber
 * 'HIST-…' (réexécutable : purge d'abord les 'HIST-%'). Ne touche pas à la
 * logique fiscale (insertion de fixtures, pas de modification du moteur de vente).
 *
 * Usage :
 *   DATABASE_URL='postgresql://caisse:caisse@localhost:5432/caisse' \
 *   TS_NODE_TRANSPILE_ONLY=1 TS_NODE_PROJECT=tsconfig.json \
 *   npx ts-node -r tsconfig-paths/register src/database/seeds/seed-analytics-history.ts
 */
import { DataSource } from 'typeorm';
import * as path from 'path';
import { StoreEntity } from '../entities/store.entity';
import { ProductEntity } from '../entities/product.entity';
import { SaleEntity } from '../entities/sale.entity';
import { SaleLineItemEntity } from '../entities/sale-line-item.entity';

/** Profil de ventes par produit (unités vendues le jour J-offset). */
type Profile = (dayAgo: number) => number;
const profiles: Record<string, { profile: Profile; setStock?: number }> = {
  // Steady ~4/j sur 45 j
  'T-Shirt Blanc': { profile: (d) => (d <= 45 ? 3 + (d % 3) : 0) },
  // Star : monte de 1 → ~9/j sur 40 j (plus récent = plus fort)
  'Casquette Sport': { profile: (d) => (d <= 40 ? Math.max(1, Math.round((40 - d) / 4)) : 0) },
  // Déclin : fort il y a 20-45 j, faible récemment
  'Jean Slim Noir': { profile: (d) => (d > 20 && d <= 45 ? 8 : d <= 20 ? 1 : 0) },
  // Réassort : forte demande récente + stock bas
  'Chaussettes (paire)': { profile: (d) => (d <= 10 ? 6 : 0), setStock: 8 },
  // Dormant : seulement il y a 38-45 j, rien depuis
  'Echarpe Laine': { profile: (d) => (d >= 38 && d <= 45 ? 2 : 0) },
  // Occasionnel + un pic il y a ~365 j (pour N-1)
  'Sac a Main': { profile: (d) => (d % 9 === 0 && d <= 45 ? 1 : d >= 364 && d <= 366 ? 3 : 0) },
};

async function run() {
  // ── Garde-fou : fixture DEV/DEMO uniquement, JAMAIS en production ──
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_SEED === undefined && /prod/i.test(process.env.DATABASE_URL || '')) {
    console.error('REFUSÉ : seed analytics = fixture DEV/local uniquement (NODE_ENV=production ou DATABASE_URL prod détecté).');
    process.exit(1);
  }

  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [path.join(__dirname, '../entities/*.entity.{ts,js}')],
    synchronize: false,
  });
  await ds.initialize();
  const storeRepo = ds.getRepository(StoreEntity);
  const productRepo = ds.getRepository(ProductEntity);
  const saleRepo = ds.getRepository(SaleEntity);
  const lineRepo = ds.getRepository(SaleLineItemEntity);

  const store = await storeRepo.findOne({ where: { name: 'Boutique Paris' } });
  if (!store) throw new Error('Store "Boutique Paris" introuvable — lancez seed.ts d’abord.');
  const storeId = store.id;

  // Purge des ventes d'historique précédentes (réexécutable).
  const old = await saleRepo.createQueryBuilder('s')
    .select('s.id', 'id').where('s.store_id = :storeId', { storeId })
    .andWhere("s.ticket_number LIKE 'HIST-%'").getRawMany<{ id: string }>();
  if (old.length) {
    const ids = old.map((o) => o.id);
    await lineRepo.createQueryBuilder().delete().where('sale_id IN (:...ids)', { ids }).execute();
    await saleRepo.createQueryBuilder().delete().where('id IN (:...ids)', { ids }).execute();
    console.log(`Purged ${ids.length} previous HIST sales`);
  }

  const products = await productRepo.find({ where: { storeId } });
  let costUpdates = 0;
  for (const p of products) {
    if (p.costMinorUnits == null) {
      p.costMinorUnits = Math.round(p.priceMinorUnits * 0.6); // marge ~40%
      await productRepo.save(p);
      costUpdates++;
    }
    const cfg = profiles[p.name];
    if (cfg?.setStock != null) { p.stockQuantity = cfg.setStock; await productRepo.save(p); }
  }
  console.log(`Costs set on ${costUpdates} products`);

  let n = 0;
  for (const p of products) {
    const cfg = profiles[p.name];
    if (!cfg) continue;
    for (let dayAgo = 0; dayAgo <= 366; dayAgo++) {
      const qty = cfg.profile(dayAgo);
      if (qty <= 0) continue;
      const when = new Date(Date.now() - dayAgo * 86_400_000);
      when.setUTCHours(9, 30, 0, 0); // ~11h30 Paris — inclut le jour courant (CA jour)
      const total = qty * p.priceMinorUnits;
      const sale = await saleRepo.save({
        storeId, employeeId: 'seed-history', employeeNameSnapshot: 'Seed History',
        ticketNumber: `HIST-${p.id.slice(0, 4)}-${dayAgo}`,
        status: 'completed', subtotalMinorUnits: total, taxTotalMinorUnits: 0,
        discountTotalMinorUnits: 0, totalMinorUnits: total, currencyCode: 'EUR',
      } as Partial<SaleEntity> as SaleEntity);
      await saleRepo.update(sale.id, { createdAt: when, completedAt: when } as any);
      await lineRepo.save({
        saleId: sale.id, productId: p.id, productName: p.name, ean: p.ean,
        quantity: qty, unitPriceMinorUnits: p.priceMinorUnits,
        lineTotalMinorUnits: total, taxRate: p.taxRate ?? 20,
      } as Partial<SaleLineItemEntity> as SaleLineItemEntity);
      n++;
    }
  }
  console.log(`Inserted ${n} historical sales across ${Object.keys(profiles).length} products`);
  await ds.destroy();
  console.log('Analytics history seed complete.');
}

run().catch((e) => { console.error('Seed analytics history failed:', e); process.exit(1); });
