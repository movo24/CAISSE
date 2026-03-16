/**
 * Database Seed Script
 *
 * Creates initial data for development:
 * - 1 store (Paris)
 * - 1 admin employee
 * - Sample products
 * - Sample promo (buy 2 get 3rd at -50%)
 * - First-purchase promo rule
 *
 * Usage: npx ts-node src/database/seeds/seed.ts
 */

import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { StoreEntity } from '../entities/store.entity';
import { EmployeeEntity } from '../entities/employee.entity';
import { ProductEntity } from '../entities/product.entity';
import { PromoRuleEntity } from '../entities/promo-rule.entity';

async function seed() {
  const ds = new DataSource({
    type: 'postgres',
    url:
      process.env.DATABASE_URL ||
      'postgresql://caisse:caisse@localhost:5432/caisse',
    entities: [StoreEntity, EmployeeEntity, ProductEntity, PromoRuleEntity],
    // NEVER synchronize in seed — use migrations instead.
    // Set TYPEORM_SYNCHRONIZE=true ONLY for initial dev setup.
    synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true',
  });

  await ds.initialize();
  console.log('Connected to database');

  // 1. Create store
  const storeRepo = ds.getRepository(StoreEntity);
  let store = await storeRepo.findOne({ where: { name: 'Boutique Paris' } });
  if (!store) {
    store = await storeRepo.save({
      name: 'Boutique Paris',
      address: '42 Rue de Rivoli',
      postalCode: '75001',
      city: 'Paris',
      phone: '+33 1 42 00 00 00',
      email: 'paris@caisse.dev',
      currencyCode: 'EUR',
      timezone: 'Europe/Paris',
      taxId: 'FR12345678901',
      // French legal compliance
      siret: '12345678901234',
      siren: '123456789',
      naf: '4771Z',
      tvaIntracom: 'FR 12 123456789',
      rcs: 'RCS Paris B 123 456 789',
      capitalSocial: '10 000 EUR',
      formeJuridique: 'SAS',
      // POS software
      softwareName: 'CAISSE POS',
      softwareVersion: '1.0.0',
      nifCaisse: 'NF525-2024-CAISSE-001',
      // Ticket
      footerMessage: 'Merci de votre visite !',
    });
    console.log(`Store created: ${store.name} (${store.id})`);
  }

  // 2. Create admin employee (PIN: 1234)
  const empRepo = ds.getRepository(EmployeeEntity);
  let admin = await empRepo.findOne({
    where: { email: 'admin@caisse.dev' },
  });
  if (!admin) {
    const pinHash = await bcrypt.hash('1234', 12);
    admin = await empRepo.save({
      firstName: 'Admin',
      lastName: 'Manager',
      email: 'admin@caisse.dev',
      pinHash,
      qrCode: `EMP-${uuidv4().slice(0, 8).toUpperCase()}`,
      role: 'admin',
      storeId: store.id,
      maxDiscountPercent: 100,
    });
    console.log(`Admin employee created: ${admin.firstName} ${admin.lastName} (PIN: 1234, QR: ${admin.qrCode})`);
  }

  // 3. Create cashier employee (PIN: 5678)
  let cashier = await empRepo.findOne({
    where: { email: 'cashier@caisse.dev' },
  });
  if (!cashier) {
    const pinHash = await bcrypt.hash('5678', 12);
    cashier = await empRepo.save({
      firstName: 'Marie',
      lastName: 'Dupont',
      email: 'cashier@caisse.dev',
      pinHash,
      qrCode: `EMP-${uuidv4().slice(0, 8).toUpperCase()}`,
      role: 'cashier',
      storeId: store.id,
      maxDiscountPercent: 5,
    });
    console.log(`Cashier created: ${cashier.firstName} ${cashier.lastName} (PIN: 5678, QR: ${cashier.qrCode})`);
  }

  // 4. Create sample products
  const prodRepo = ds.getRepository(ProductEntity);
  const products = [
    { ean: '3760001000001', name: 'T-Shirt Blanc', priceMinorUnits: 2990, taxRate: 20, stockQuantity: 50, unitType: 'unit' },
    { ean: '3760001000002', name: 'Jean Slim Noir', priceMinorUnits: 5990, taxRate: 20, stockQuantity: 30, unitType: 'unit' },
    { ean: '3760001000003', name: 'Chaussettes (paire)', priceMinorUnits: 890, taxRate: 20, stockQuantity: 100, unitType: 'pair' },
    { ean: '3760001000004', name: 'Veste en Cuir', priceMinorUnits: 19900, taxRate: 20, stockQuantity: 8, unitType: 'unit' },
    { ean: '3760001000005', name: 'Echarpe Laine', priceMinorUnits: 3490, taxRate: 20, stockQuantity: 25, unitType: 'unit' },
    { ean: '3760001000006', name: 'Casquette Sport', priceMinorUnits: 1990, taxRate: 20, stockQuantity: 40, unitType: 'unit' },
    { ean: '3760001000007', name: 'Sac a Main', priceMinorUnits: 8900, taxRate: 20, stockQuantity: 12, unitType: 'unit' },
    { ean: '3760001000008', name: 'Ceinture Cuir', priceMinorUnits: 2490, taxRate: 20, stockQuantity: 35, unitType: 'unit' },
  ];

  for (const p of products) {
    const existing = await prodRepo.findOne({
      where: { ean: p.ean, storeId: store.id },
    });
    if (!existing) {
      await prodRepo.save({
        ...p,
        storeId: store.id,
        currencyCode: 'EUR',
        costMinorUnits: Math.round(p.priceMinorUnits * 0.4),
        stockAlertThreshold: 10,
        stockCriticalThreshold: 5,
      });
      console.log(`Product created: ${p.name} (${p.ean}) - ${(p.priceMinorUnits / 100).toFixed(2)} EUR`);
    }
  }

  // 5. Create promo: Buy 2 get 3rd at -50% on chaussettes
  const promoRepo = ds.getRepository(PromoRuleEntity);
  let promo = await promoRepo.findOne({
    where: { name: '3eme paire a -50%' },
  });
  if (!promo) {
    const socksProduct = await prodRepo.findOne({
      where: { ean: '3760001000003', storeId: store.id },
    });
    promo = await promoRepo.save(promoRepo.create({
      name: '3eme paire a -50%',
      type: 'buy_x_get_discount',
      storeId: store.id,
      buyQuantity: 2,
      discountPercent: 50,
      applicableProductIds: socksProduct ? [socksProduct.id] : [],
      applicableCategoryIds: [],
      startDate: new Date('2024-01-01'),
      endDate: null as any,
      isActive: true,
    }));
    console.log(`Promo created: ${promo!.name}`);
  }

  // 6. Create first-purchase promo (-5%)
  let firstPurchasePromo = await promoRepo.findOne({
    where: { name: 'Bienvenue -5%' },
  });
  if (!firstPurchasePromo) {
    firstPurchasePromo = await promoRepo.save(promoRepo.create({
      name: 'Bienvenue -5%',
      type: 'first_purchase',
      storeId: store.id,
      discountPercent: 5,
      applicableProductIds: [],
      applicableCategoryIds: [],
      startDate: new Date('2024-01-01'),
      endDate: null as any,
      isActive: true,
    }));
    console.log(`Promo created: ${firstPurchasePromo!.name}`);
  }

  console.log('\nSeed complete!');
  console.log(`\nStore ID: ${store.id}`);
  console.log(`Admin PIN: 1234`);
  console.log(`Cashier PIN: 5678`);

  await ds.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
