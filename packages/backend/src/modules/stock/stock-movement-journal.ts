/**
 * POS-081/082 — Stock movement journal emission (P306, cycle E — option 1 du
 * dossier STOCK_UNIFICATION_DECISION.md, GO 2026-07-02).
 *
 * `products.stock_quantity` reste LE compteur opérationnel (système A, inchangé).
 * Ces helpers alimentent le journal append-only `stock_movements` (système B)
 * depuis les faits caisse — vente, retour client, ajustement — DANS LA MÊME
 * TRANSACTION que l'opération métier (EntityManager du caller), afin que le
 * journal ne puisse pas diverger du fait commis.
 *
 * Conception : fonctions pures sur EntityManager (pas d'@Injectable) pour être
 * appelables depuis sales/returns/stock sans couplage de modules Nest.
 * Le mapping magasin → stock_location(type='store') est créé PARESSEUSEMENT.
 */
import type { EntityManager } from 'typeorm';
import { StockLocationEntity } from '../../database/entities/stock-location.entity';
import { StockMovementEntity } from '../../database/entities/stock-movement.entity';

export interface JournalActor {
  employeeId: string;
  employeeName?: string | null;
}

/** Codes générés pour les locations magasin auto-créées (unique ≤ 20 chars). */
export function storeLocationCode(storeId: string): string {
  return `ST-${storeId.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

/**
 * Find-or-create the `stock_location` of a store (type='store'), inside the
 * caller's transaction. Idempotent: keyed on store_id first, code as fallback.
 */
export async function ensureStoreLocation(
  manager: EntityManager,
  storeId: string,
  storeName?: string | null,
): Promise<StockLocationEntity> {
  const existing = await manager.findOne(StockLocationEntity, {
    where: { storeId, type: 'store' } as any,
  });
  if (existing) return existing;
  const code = storeLocationCode(storeId);
  const byCode = await manager.findOne(StockLocationEntity, { where: { code } as any });
  if (byCode) return byCode;
  return manager.save(
    manager.create(StockLocationEntity, {
      name: (storeName || `Magasin ${storeId.slice(0, 8)}`).slice(0, 100),
      code,
      type: 'store',
      storeId,
      isActive: true,
    } as Partial<StockLocationEntity>),
  );
}

/** SALE — from=store location, to=null (left the network). One row per line. */
export async function recordSaleMovements(
  manager: EntityManager,
  args: {
    storeId: string;
    storeName?: string | null;
    actor: JournalActor;
    ticketNumber: string;
    items: Array<{ productId: string; quantity: number }>;
  },
): Promise<void> {
  const items = args.items.filter((i) => i.productId && i.quantity > 0);
  if (items.length === 0) return;
  const loc = await ensureStoreLocation(manager, args.storeId, args.storeName);
  await manager.insert(
    StockMovementEntity,
    items.map((i) => ({
      productId: i.productId,
      movementType: 'sale' as const,
      fromLocationId: loc.id,
      toLocationId: null,
      quantity: i.quantity,
      reference: args.ticketNumber,
      reason: 'Vente POS',
      employeeId: args.actor.employeeId,
      employeeName: args.actor.employeeName || 'inconnu',
    })),
  );
}

/** CUSTOMER RETURN — from=null, to=store location (came back in). */
export async function recordReturnMovements(
  manager: EntityManager,
  args: {
    storeId: string;
    storeName?: string | null;
    actor: JournalActor;
    creditNoteCode: string;
    items: Array<{ productId: string | null; quantity: number }>;
  },
): Promise<void> {
  const items = args.items.filter((i) => !!i.productId && i.quantity > 0) as Array<{
    productId: string;
    quantity: number;
  }>;
  if (items.length === 0) return;
  const loc = await ensureStoreLocation(manager, args.storeId, args.storeName);
  await manager.insert(
    StockMovementEntity,
    items.map((i) => ({
      productId: i.productId,
      movementType: 'return_customer' as const,
      fromLocationId: null,
      toLocationId: loc.id,
      quantity: i.quantity,
      reference: args.creditNoteCode,
      reason: 'Retour client (avoir)',
      employeeId: args.actor.employeeId,
      employeeName: args.actor.employeeName || 'inconnu',
    })),
  );
}

/**
 * MANUAL ADJUSTMENT — signed delta: positive → to=store (entrée), negative →
 * from=store (sortie). `quantity` is stored positive (direction = from/to),
 * matching the entity's contract. Zero delta emits nothing.
 */
export async function recordAdjustMovement(
  manager: EntityManager,
  args: {
    storeId: string;
    storeName?: string | null;
    actor: JournalActor;
    productId: string;
    deltaQuantity: number;
    reason: string;
  },
): Promise<void> {
  if (!args.deltaQuantity) return;
  const loc = await ensureStoreLocation(manager, args.storeId, args.storeName);
  await manager.insert(StockMovementEntity, {
    productId: args.productId,
    movementType: 'inventory_adjust',
    fromLocationId: args.deltaQuantity < 0 ? loc.id : null,
    toLocationId: args.deltaQuantity > 0 ? loc.id : null,
    quantity: Math.abs(args.deltaQuantity),
    reference: null as any,
    reason: args.reason.slice(0, 500),
    employeeId: args.actor.employeeId,
    employeeName: args.actor.employeeName || 'inconnu',
  });
}

/**
 * PROJECTION (lecture) — net journal quantity per product for a store location:
 * Σ(to=loc) − Σ(from=loc). Balance = projection reconstruite (sous-choix retenu
 * du dossier) ; aucune écriture dans stock_balance depuis le chemin caisse.
 */
export async function journalNetQuantities(
  manager: EntityManager,
  locationId: string,
): Promise<Record<string, number>> {
  const rows: Array<{ product_id: string; net: string }> = await manager.query(
    `SELECT product_id,
            COALESCE(SUM(CASE WHEN to_location_id = $1 THEN quantity ELSE 0 END),0)
          - COALESCE(SUM(CASE WHEN from_location_id = $1 THEN quantity ELSE 0 END),0) AS net
       FROM stock_movements
      WHERE to_location_id = $1 OR from_location_id = $1
      GROUP BY product_id`,
    [locationId],
  );
  const map: Record<string, number> = {};
  for (const r of rows) map[r.product_id] = parseInt(r.net, 10);
  return map;
}
