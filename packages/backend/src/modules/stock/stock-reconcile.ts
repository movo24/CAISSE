/**
 * P308 (cycle F) — Stock reconciliation (read-only, supervision).
 *
 * Compares, per product of a store, the three views that now coexist after the
 * option-1 unification (STOCK_UNIFICATION_DECISION.md §6):
 *   counter    = products.stock_quantity        (système A — vérité opérationnelle)
 *   journalNet = Σ(in) − Σ(out) stock_movements (dérivé, depuis P306 seulement)
 *   balance    = stock_balances.quantity        (système B legacy, incrémental)
 *
 * IMPORTANT (honnêteté) : le journal ne démarre qu'à P306 et il n'y a pas de
 * backfill → `journalNet` n'égale PAS `counter` pour un produit ayant un stock
 * antérieur. La réconciliation expose donc un `journalDelta` = variation nette
 * expliquée par le journal, et signale `balanceDrift` (balance B ≠ compteur A)
 * qui, lui, DOIT converger pour les magasins pilotés par stock-locations.
 * Fonctions pures sur EntityManager — testables pg-mem, réutilisables.
 */
import type { EntityManager } from 'typeorm';
import { StockLocationEntity } from '../../database/entities/stock-location.entity';

export interface StockReconRow {
  productId: string;
  productName: string;
  counter: number; // products.stock_quantity
  journalNet: number | null; // null = aucun mouvement journalisé pour ce produit
  balance: number | null; // null = pas de ligne stock_balances (location legacy absente)
  balanceDrift: number | null; // balance − counter (null si balance absente)
}

export interface StockReconReport {
  storeId: string;
  locationId: string | null; // null = aucune stock_location pour ce magasin
  rows: StockReconRow[];
  driftCount: number; // nb de produits où balance existe et diverge du compteur
  generatedAt: string;
}

/** Read-only reconciliation for one store. */
export async function reconcileStoreStock(
  manager: EntityManager,
  storeId: string,
): Promise<StockReconReport> {
  const loc = await manager.findOne(StockLocationEntity, {
    where: { storeId, type: 'store' } as any,
  });

  const rows: Array<{
    product_id: string;
    name: string;
    counter: string;
    journal_net: string | null;
    balance: string | null;
  }> = await manager.query(
    `SELECT p.id AS product_id,
            p.name AS name,
            p.stock_quantity AS counter,
            j.net AS journal_net,
            b.quantity AS balance
       FROM products p
       LEFT JOIN (
         SELECT product_id,
                COALESCE(SUM(CASE WHEN to_location_id   = $2 THEN quantity ELSE 0 END),0)
              - COALESCE(SUM(CASE WHEN from_location_id = $2 THEN quantity ELSE 0 END),0) AS net
           FROM stock_movements
          WHERE to_location_id = $2 OR from_location_id = $2
          GROUP BY product_id
       ) j ON j.product_id = p.id
       LEFT JOIN stock_balances b ON b.product_id = p.id AND b.location_id = $2
      WHERE p.store_id = $1 AND p.is_active = true
      ORDER BY p.name ASC`,
    [storeId, loc?.id ?? '00000000-0000-4000-8000-000000000000'],
  );

  const out: StockReconRow[] = rows.map((r) => {
    const counter = parseInt(r.counter, 10) || 0;
    const balance = r.balance === null || r.balance === undefined ? null : parseInt(r.balance, 10);
    return {
      productId: r.product_id,
      productName: r.name,
      counter,
      journalNet: r.journal_net === null || r.journal_net === undefined ? null : parseInt(r.journal_net, 10),
      balance,
      balanceDrift: balance === null ? null : balance - counter,
    };
  });

  return {
    storeId,
    locationId: loc?.id ?? null,
    rows: out,
    driftCount: out.filter((r) => r.balanceDrift !== null && r.balanceDrift !== 0).length,
    generatedAt: new Date().toISOString(),
  };
}
