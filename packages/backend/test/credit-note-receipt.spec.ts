/**
 * Bloc 10g (POS mission) — credit-note (avoir/refund) receipt + reprint audit.
 * Decisive: a refund/avoir is printable for customer proof (content correct,
 * original ticket referenced), and a staff reprint writes a who/when entry to
 * the per-store audit chain (the server-side trail that was missing).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { SaleLineItemEntity } from '../src/database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../src/database/entities/sale-payment.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { CreditNoteEntity } from '../src/database/entities/credit-note.entity';
import { CreditNoteLineEntity } from '../src/database/entities/credit-note-line.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { ReceiptsController } from '../src/modules/receipts/receipts.controller';

describe('Bloc 10g — credit-note receipt + reprint audit', () => {
  let ds: DataSource;
  let ctrl: ReceiptsController;
  const STORE = uuidv4();
  const CN = uuidv4();
  const ADMIN = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B43', isActive: true, currencyCode: 'EUR', siret: '12345678900011' } as any);
    await ds.getRepository(CreditNoteEntity).save({
      id: CN, code: 'AV-000007', storeId: STORE, type: 'refund', refundMethod: 'cash',
      originalTicketNumber: 'T-000123', status: 'refunded', totalMinorUnits: 1500, remainingMinorUnits: 0,
      employeeId: ADMIN, employeeNameSnapshot: 'Alice', currencyCode: 'EUR',
    } as any);
    await ds.getRepository(CreditNoteLineEntity).save({
      id: uuidv4(), creditNoteId: CN, productId: uuidv4(), productName: 'Bonbon', ean: '3600000000017',
      quantity: 3, unitPriceMinorUnits: 500, lineTotalMinorUnits: 1500, taxRate: 20,
    } as any);

    const mail = { send: jest.fn() } as any;
    ctrl = new ReceiptsController(
      ds.getRepository(SaleEntity),
      ds.getRepository(SaleLineItemEntity),
      ds.getRepository(SalePaymentEntity),
      ds.getRepository(StoreEntity),
      ds.getRepository(CreditNoteEntity),
      ds.getRepository(CreditNoteLineEntity),
      mail,
      new AuditService(ds.getRepository(AuditEntryEntity), ds),
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('DECISIVE — credit-note receipt carries the refund details + original ticket', async () => {
    const r = await ctrl.getCreditNoteReceipt(CN);
    expect(r).toMatchObject({
      kind: 'credit_note',
      code: 'AV-000007',
      creditType: 'refund',
      refundMethod: 'Espèces',
      originalTicketNumber: 'T-000123',
      total: 15,
      remaining: 0,
      cashier: 'Alice',
    });
    expect(r.items).toEqual([{ name: 'Bonbon', quantity: 3, unitPrice: 5, total: 15 }]);
    expect(r.store).toMatchObject({ name: 'B43', siret: '12345678900011' });
  });

  it('renders a printable HTML page (refund framing + amount + original ticket)', async () => {
    const html = await ctrl.getCreditNoteReceiptHtml(CN);
    expect(html).toContain('Remboursement');
    expect(html).toContain('AV-000007');
    expect(html).toContain('15.00 €');
    expect(html).toContain("Ticket d'origine : T-000123");
  });

  it('DECISIVE — a staff reprint appends a who/when entry to the store audit chain', async () => {
    const before = await ds.getRepository(AuditEntryEntity).count({ where: { storeId: STORE } });
    await ctrl.reprintCreditNote(CN, { user: { employeeId: ADMIN } } as any);
    const rows = await ds.getRepository(AuditEntryEntity).find({ where: { storeId: STORE }, order: { timestamp: 'DESC' } });
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ action: 'receipt_reprinted', entityType: 'credit_note', entityId: CN, employeeId: ADMIN });
    expect((rows[0].details as any).code).toBe('AV-000007');
    expect((rows[0].details as any).reprintedAt).toBeTruthy();
  });

  it('ADVERSE — unknown credit-note id → 404 (no audit noise)', async () => {
    const before = await ds.getRepository(AuditEntryEntity).count({ where: { storeId: STORE } });
    await expect(ctrl.getCreditNoteReceipt(uuidv4())).rejects.toThrow(/introuvable/);
    await expect(ctrl.getCreditNoteReceipt('not-a-uuid')).rejects.toThrow(/introuvable/);
    expect(await ds.getRepository(AuditEntryEntity).count({ where: { storeId: STORE } })).toBe(before);
  });
});
