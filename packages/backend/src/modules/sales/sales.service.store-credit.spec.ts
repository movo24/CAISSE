import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';

import { SalesService } from './sales.service';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { AuditService } from '../audit/audit.service';
import { ProductsService } from '../products/products.service';
import { CustomersService } from '../customers/customers.service';
import { PromotionsService } from '../promotions/promotions.service';
import { StockService } from '../stock/stock.service';
import { JackpotService } from '../jackpot/jackpot.service';
import { TimewinService } from '../timewin/timewin.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { PosSessionService } from '../pos-session/pos-session.service';
import { OperatorAttributionService } from '../operator-attribution/operator-attribution.service';

/** Redemption of store-credit avoirs as a sale tender (chantier 1b). */
describe('SalesService — applyStoreCreditRedemptions', () => {
  let service: SalesService;

  beforeEach(async () => {
    const noop = {};
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: getRepositoryToken(SaleEntity), useValue: noop },
        { provide: getRepositoryToken(SaleLineItemEntity), useValue: noop },
        { provide: getRepositoryToken(SalePaymentEntity), useValue: noop },
        { provide: getRepositoryToken(IdempotencyKeyEntity), useValue: noop },
        { provide: DataSource, useValue: {} },
        { provide: ProductsService, useValue: noop },
        { provide: CustomersService, useValue: noop },
        { provide: PromotionsService, useValue: noop },
        { provide: AuditService, useValue: noop },
        { provide: StockService, useValue: noop },
        { provide: JackpotService, useValue: noop },
        { provide: TimewinService, useValue: noop },
        { provide: RealtimeService, useValue: { emit: jest.fn() } },
        { provide: PosSessionService, useValue: { findActiveForTerminal: jest.fn() } },
        { provide: OperatorAttributionService, useValue: { recordWithinTransaction: jest.fn() } },
      ],
    }).compile();
    service = module.get(SalesService);
  });

  const qrWith = (rows: any[]) => ({ query: jest.fn().mockResolvedValueOnce(rows).mockResolvedValue([]) }) as any;

  it('ignores non store_credit payments', async () => {
    const qr = qrWith([]);
    await service.applyStoreCreditRedemptions(qr, 's1', 'sale1', [{ method: 'cash', amountMinorUnits: 500 }]);
    expect(qr.query).not.toHaveBeenCalled();
  });

  it('requires a creditNoteCode for store_credit payments', async () => {
    const qr = qrWith([]);
    await expect(
      service.applyStoreCreditRedemptions(qr, 's1', 'sale1', [{ method: 'store_credit', amountMinorUnits: 500 }]),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an unknown avoir', async () => {
    const qr = qrWith([]); // SELECT FOR UPDATE → no rows
    await expect(
      service.applyStoreCreditRedemptions(qr, 's1', 'sale1', [{ method: 'store_credit', amountMinorUnits: 500, creditNoteCode: 'AV-X' }]),
    ).rejects.toThrow(/introuvable/);
  });

  it('rejects when the balance is insufficient', async () => {
    const qr = qrWith([{ id: 'cn1', remaining_minor_units: 300, status: 'active', type: 'store_credit' }]);
    await expect(
      service.applyStoreCreditRedemptions(qr, 's1', 'sale1', [{ method: 'store_credit', amountMinorUnits: 500, creditNoteCode: 'AV-X' }]),
    ).rejects.toThrow(/insuffisant/);
  });

  it('rejects an already-redeemed avoir', async () => {
    const qr = qrWith([{ id: 'cn1', remaining_minor_units: 0, status: 'redeemed', type: 'store_credit' }]);
    await expect(
      service.applyStoreCreditRedemptions(qr, 's1', 'sale1', [{ method: 'store_credit', amountMinorUnits: 100, creditNoteCode: 'AV-X' }]),
    ).rejects.toThrow(/déjà utilisé/);
  });

  it('partial use decrements balance and marks partially_redeemed + records redemption', async () => {
    const qr = qrWith([{ id: 'cn1', remaining_minor_units: 1000, status: 'active', type: 'store_credit' }]);
    await service.applyStoreCreditRedemptions(qr, 's1', 'sale1', [{ method: 'store_credit', amountMinorUnits: 400, creditNoteCode: 'AV-X' }]);
    const update = qr.query.mock.calls.find((c: any[]) => /UPDATE credit_notes/.test(c[0]));
    expect(update[1]).toEqual([600, 'partially_redeemed', 'cn1']);
    const insert = qr.query.mock.calls.find((c: any[]) => /INSERT INTO credit_note_redemptions/.test(c[0]));
    expect(insert[1]).toEqual(expect.arrayContaining(['cn1', 'sale1', 's1', 400]));
  });

  it('full use marks the avoir redeemed', async () => {
    const qr = qrWith([{ id: 'cn1', remaining_minor_units: 400, status: 'active', type: 'store_credit' }]);
    await service.applyStoreCreditRedemptions(qr, 's1', 'sale1', [{ method: 'store_credit', amountMinorUnits: 400, creditNoteCode: 'AV-X' }]);
    const update = qr.query.mock.calls.find((c: any[]) => /UPDATE credit_notes/.test(c[0]));
    expect(update[1]).toEqual([0, 'redeemed', 'cn1']);
  });
});
