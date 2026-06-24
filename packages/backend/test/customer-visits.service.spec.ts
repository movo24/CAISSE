/**
 * M304 — CustomerVisitsService characterization (visit dedup + listing).
 *
 * Focuses on the business-meaningful logic: the 5-minute anti-duplicate window
 * (same customer + same store → returns the existing visit, no insert) and
 * listForCustomer ordering/limit. Runs on pg-mem.
 *
 * NOT asserted here: the `customers.visit_count = visit_count + 1` increment —
 * pg-mem mistypes integer arithmetic as string concatenation, so exact-count
 * proofs belong in a gated real-Postgres spec. We deliberately leave the
 * customers table empty so that UPDATE is a 0-row no-op and never runs the
 * mistyped arithmetic.
 */
import './helpers/env-setup';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { CustomerVisitsService } from '../src/modules/customer-visits/customer-visits.service';
import { CustomerVisitEntity } from '../src/database/entities/customer-visit.entity';

describe('M304 — CustomerVisitsService', () => {
  let ds: DataSource;
  let svc: CustomerVisitsService;
  const CUST = uuidv4();
  const STORE_A = uuidv4();
  const STORE_B = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = await dataSource.initialize();
    svc = new CustomerVisitsService(ds.getRepository(CustomerVisitEntity), ds);
  });
  afterAll(async () => {
    await ds?.destroy();
  });
  beforeEach(async () => {
    await ds.query('DELETE FROM customer_visits');
  });

  const rowCount = async (customerId: string) =>
    ds.getRepository(CustomerVisitEntity).count({ where: { customerId } });

  const backdate = (id: string, minutesAgo: number) =>
    ds.query('UPDATE customer_visits SET visited_at = $1 WHERE id = $2', [
      new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
      id,
    ]);

  describe('recordVisit', () => {
    it('records a first visit (not a duplicate)', async () => {
      const r = await svc.recordVisit({ customerId: CUST, storeId: STORE_A });
      expect(r.isDuplicate).toBe(false);
      expect(r.visitId).toBeTruthy();
      expect(await rowCount(CUST)).toBe(1);
    });

    it('treats a re-scan of the same store within 5 min as a duplicate (no new row)', async () => {
      const first = await svc.recordVisit({ customerId: CUST, storeId: STORE_A });
      const again = await svc.recordVisit({ customerId: CUST, storeId: STORE_A });
      expect(again.isDuplicate).toBe(true);
      expect(again.visitId).toBe(first.visitId); // same visit returned
      expect(await rowCount(CUST)).toBe(1); // nothing inserted
    });

    it('does NOT dedup across different stores', async () => {
      await svc.recordVisit({ customerId: CUST, storeId: STORE_A });
      const b = await svc.recordVisit({ customerId: CUST, storeId: STORE_B });
      expect(b.isDuplicate).toBe(false);
      expect(await rowCount(CUST)).toBe(2);
    });

    it('records a new visit once the prior one is older than the 5-min window', async () => {
      const first = await svc.recordVisit({ customerId: CUST, storeId: STORE_A });
      await backdate(first.visitId, 6); // push it outside the window
      const next = await svc.recordVisit({ customerId: CUST, storeId: STORE_A });
      expect(next.isDuplicate).toBe(false);
      expect(await rowCount(CUST)).toBe(2);
    });
  });

  describe('listForCustomer', () => {
    it('returns visits newest-first and respects the limit', async () => {
      // Three visits across distinct stores (avoid the dedup window), then
      // backdate to deterministic, strictly-ordered timestamps.
      const v1 = await svc.recordVisit({ customerId: CUST, storeId: STORE_A });
      const v2 = await svc.recordVisit({ customerId: CUST, storeId: STORE_B });
      const v3 = await svc.recordVisit({ customerId: CUST, storeId: uuidv4() });
      await backdate(v1.visitId, 30);
      await backdate(v2.visitId, 20);
      await backdate(v3.visitId, 10); // most recent

      const top2 = await svc.listForCustomer(CUST, 2);
      expect(top2).toHaveLength(2);
      expect(top2[0].id).toBe(v3.visitId); // newest first
      expect(top2[1].id).toBe(v2.visitId);
    });

    it('returns an empty list for a customer with no visits', async () => {
      expect(await svc.listForCustomer(uuidv4())).toEqual([]);
    });
  });
});
