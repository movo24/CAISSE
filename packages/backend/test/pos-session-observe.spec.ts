/**
 * Bloc 3.4/3.5 (POS mission) — TimeWin hardening. A POS session open/close now
 * (a) pushes session.opened/closed to TimeWin24 and (b) records a durable,
 * attributable connection-history entry in the per-store audit chain. Both are
 * best-effort: a TimeWin or audit failure NEVER blocks the session lifecycle.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { PosSessionEntity } from '../src/database/entities/pos-session.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { PosSessionService } from '../src/modules/pos-session/pos-session.service';

describe('Bloc 3.4/3.5 — session lifecycle observability', () => {
  let ds: DataSource;
  let audit: AuditService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const snapshot = { employeeName: 'Alice', employeeRole: 'cashier', maxDiscount: 10 };

  const auditRows = () =>
    ds.getRepository(AuditEntryEntity).find({ where: { storeId: STORE }, order: { timestamp: 'ASC' } });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    audit = new AuditService(ds.getRepository(AuditEntryEntity), ds);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('DECISIVE — open pushes session.opened to TW24 AND writes a connection-history audit entry', async () => {
    const pushEvent = jest.fn().mockResolvedValue({ received: true, eventId: 'e1' });
    const svc = new PosSessionService(ds.getRepository(PosSessionEntity), { pushEvent } as any, audit);
    const session = await svc.openSession(STORE, EMP, snapshot, { terminalId: 'TERM-A' });

    expect(pushEvent).toHaveBeenCalledWith(STORE, 'session.opened', EMP, expect.objectContaining({ sessionId: session.id, terminalId: 'TERM-A' }));
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'pos_session_opened', entityType: 'pos_session', entityId: session.id, employeeId: EMP });
    expect((rows[0].details as any).terminalId).toBe('TERM-A');
    expect((rows[0].details as any).employeeName).toBe('Alice');
  });

  it('DECISIVE — close pushes session.closed AND chains a second audit entry', async () => {
    const pushEvent = jest.fn().mockResolvedValue({ received: true, eventId: 'e2' });
    const svc = new PosSessionService(ds.getRepository(PosSessionEntity), { pushEvent } as any, audit);
    const open = await svc.openSession(STORE, EMP, snapshot, { terminalId: 'TERM-B' });
    pushEvent.mockClear();
    const closed = await svc.closeSession(open.id, STORE, EMP);

    expect(closed.isActive).toBe(false);
    expect(pushEvent).toHaveBeenCalledWith(STORE, 'session.closed', EMP, expect.objectContaining({ sessionId: open.id }));
    const rows = await auditRows();
    const closeEntry = rows.find((r) => r.action === 'pos_session_closed' && r.entityId === open.id);
    expect(closeEntry).toBeTruthy();
    expect((await audit.verifyChain(STORE)).valid).toBe(true);
  });

  it('RESILIENCE — a TimeWin push failure never blocks the session opening', async () => {
    const pushEvent = jest.fn().mockRejectedValue(new Error('TW24 down'));
    const svc = new PosSessionService(ds.getRepository(PosSessionEntity), { pushEvent } as any, audit);
    const session = await svc.openSession(STORE, EMP, snapshot, { terminalId: 'TERM-C' });
    expect(session.isActive).toBe(true); // opened despite TW24 being down
  });

  it('RESILIENCE — with NO observability deps the session still opens (optional injection)', async () => {
    const svc = new PosSessionService(ds.getRepository(PosSessionEntity));
    const session = await svc.openSession(STORE, EMP, snapshot, { terminalId: 'TERM-D' });
    expect(session.isActive).toBe(true);
  });
});
