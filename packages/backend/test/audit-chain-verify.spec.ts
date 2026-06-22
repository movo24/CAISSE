/**
 * M402 — audit chain hardening. The legacy v1 hash serialised `details` as `{}` (an
 * array-replacer bug), so tampering `details` was undetectable. v2 covers the full
 * row via a canonical serialisation + the exact hashed timestamp, so verifyChain
 * recomputes and detects content tampering; v1 rows stay linkage-only; a fork is
 * prevented by the unique (store_id, previous_hash) index (doLog retries on conflict).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { AlertService } from '../src/common/alert/alert.service';

describe('M402 — audit chain verifyChain (recompute + linkage)', () => {
  let ds: DataSource;
  let svc: AuditService;
  let repo: ReturnType<DataSource['getRepository']>;
  const STORE = uuidv4();

  const log = (action: string, details: Record<string, unknown>) =>
    svc.log({ storeId: STORE, employeeId: 'emp-1', action, entityType: 'sale', entityId: uuidv4(), details });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    repo = ds.getRepository(AuditEntryEntity);
    svc = new AuditService(repo as any, ds);
  });
  afterAll(async () => { await ds?.destroy(); });

  it('a v2 chain written via log() verifies, and every row is recompute-verifiable (hashedAt set)', async () => {
    await log('sale_completed', { ticket: 'T-1', total: 2990 });
    await log('discount_applied', { ticket: 'T-2', pct: 10 });
    await log('drawer_opened', { reason: 'cash' });
    const res = await svc.verifyChain(STORE);
    expect(res.valid).toBe(true);
    const rows = await repo.find({ where: { storeId: STORE } });
    expect(rows.length).toBe(3);
    expect(rows.every((r: any) => r.hashedAt != null)).toBe(true);
  });

  it('DECISIVE — tampering `details` (which the v1 hash ignored) is now detected', async () => {
    const store = uuidv4();
    const e = await svc.log({ storeId: store, employeeId: 'm', action: 'discount_applied', entityType: 'sale', entityId: 'sX', details: { approver: 'mgr-1', pct: 30 } });
    // Forge the audited approver/amount while keeping hashes + linkage intact.
    await repo.update(e.id, { details: { approver: 'self', pct: 90 } });
    const res = await svc.verifyChain(store);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('hash_mismatch');
    expect(res.brokenAt).toBe(e.id);
  });

  it('DECISIVE — re-attribution (rewriting employee_id) is detected', async () => {
    const store = uuidv4();
    const e = await svc.log({ storeId: store, employeeId: 'cashier-self', action: 'discount_applied', entityType: 'sale', entityId: 'sX', details: { pct: 30 } });
    // Blame a coworker for a self-approved action — chain linkage intact.
    await repo.update(e.id, { employeeId: 'innocent-coworker' });
    const res = await svc.verifyChain(store);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('hash_mismatch');
    expect(res.brokenAt).toBe(e.id);
  });

  it('detects a LINKAGE break (a deleted middle entry)', async () => {
    const store = uuidv4();
    await svc.log({ storeId: store, employeeId: 'm', action: 'a1', entityType: 'sale', entityId: '1', details: {} });
    const mid = await svc.log({ storeId: store, employeeId: 'm', action: 'a2', entityType: 'sale', entityId: '2', details: {} });
    await svc.log({ storeId: store, employeeId: 'm', action: 'a3', entityType: 'sale', entityId: '3', details: {} });
    await repo.delete(mid.id); // chain now has a gap → 3rd row's previousHash is orphaned
    const res = await svc.verifyChain(store);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('linkage');
  });

  it('legacy v1 rows (hashedAt = null) are linkage-only — no false positive on uncovered details', async () => {
    const store = uuidv4();
    const GENESIS = '0'.repeat(64);
    // Simulate a pre-M402 row: hashedAt null, details not covered by the (irrelevant) hash.
    await repo.save({
      id: uuidv4(), storeId: store, employeeId: 'm', action: 'legacy', entityType: 'sale', entityId: 'L',
      details: { anything: 'goes' }, previousHash: GENESIS, currentHash: 'a'.repeat(64), hashedAt: null,
    } as any);
    const res = await svc.verifyChain(store);
    expect(res.valid).toBe(true); // linkage holds; v1 content is intentionally not recomputed
  });

  it('doLog RETRIES on the anti-fork unique conflict instead of forking/dropping', async () => {
    const store = uuidv4();
    const saveSpy = jest.spyOn(repo as any, 'save');
    let thrown = false;
    saveSpy.mockImplementationOnce(async () => { thrown = true; throw { code: '23505', message: 'duplicate key' }; });
    const entry = await svc.log({ storeId: store, employeeId: 'm', action: 'race', entityType: 'sale', entityId: 'R', details: {} });
    expect(thrown).toBe(true);          // first save hit the conflict
    expect(entry.id).toBeTruthy();      // retry succeeded
    saveSpy.mockRestore();
    expect((await svc.verifyChain(store)).valid).toBe(true);
  });

  it('D16 — when retries are EXHAUSTED, the dropped audit fires a critical alert (not a silent warn)', async () => {
    const fireSpy = jest.spyOn(AlertService.instance, 'fire').mockImplementation(() => {});
    const saveSpy = jest
      .spyOn(repo as any, 'save')
      .mockImplementation(async () => { throw { code: '23505', message: 'duplicate key' }; }); // every attempt conflicts
    await expect(
      svc.log({ storeId: uuidv4(), employeeId: 'm', action: 'race', entityType: 'sale', entityId: 'R', details: {} }),
    ).rejects.toBeTruthy();
    expect(fireSpy).toHaveBeenCalledWith('AUDIT_WRITE_FAILED', expect.stringContaining('dropped'));
    saveSpy.mockRestore();
    fireSpy.mockRestore();
  });
});
