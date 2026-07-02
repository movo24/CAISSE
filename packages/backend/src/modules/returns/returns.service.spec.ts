import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ReturnsService } from './returns.service';
import { CreditNoteEntity } from '../../database/entities/credit-note.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { AuditService } from '../audit/audit.service';
import { StoreOrgResolver } from '../integration/store-org-resolver';

const SALE = {
  id: 'sale-1',
  storeId: 'store-1',
  ticketNumber: 'T-000001',
  currencyCode: 'EUR',
  status: 'completed',
  lineItems: [
    { id: 'li1', productId: 'p1', productName: 'Café', ean: '111', quantity: 3, unitPriceMinorUnits: 500, lineTotalMinorUnits: 1500, taxRate: 20 },
    { id: 'li2', productId: 'p2', productName: 'Thé', ean: '222', quantity: 2, unitPriceMinorUnits: 300, lineTotalMinorUnits: 600, taxRate: 20 },
  ],
};

describe('ReturnsService', () => {
  let service: ReturnsService;
  let qr: any;
  let dataSource: any;
  let saleRepo: any;
  let idemRepo: any;
  let cnRepo: any;
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    qr = {
      connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(), release: jest.fn(), isReleased: false,
      query: jest.fn().mockResolvedValue([]), // hash SELECT → [] ; UPDATEs ignored
      manager: {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockImplementation((e: any, x: any) => Promise.resolve(x ?? e)), // 1-arg (journal) et 2-args
        insert: jest.fn(),
        // P306 — journal des mouvements (option 1): ensureStoreLocation crée la
        // location paresseusement via manager.create + save.
        create: jest.fn().mockImplementation((_e: any, o: any) => ({ id: 'loc-1', ...o })),
      },
    };
    dataSource = { createQueryRunner: () => qr, query: jest.fn().mockResolvedValue([]) };
    saleRepo = { findOne: jest.fn().mockResolvedValue(JSON.parse(JSON.stringify(SALE))) };
    idemRepo = { findOne: jest.fn().mockResolvedValue(null) };
    cnRepo = { findOne: jest.fn(), findAndCount: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: getRepositoryToken(CreditNoteEntity), useValue: cnRepo },
        { provide: getRepositoryToken(SaleEntity), useValue: saleRepo },
        { provide: getRepositoryToken(IdempotencyKeyEntity), useValue: idemRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditService, useValue: audit },
        // POS-INT-120 — integration DI added during the epic; mocked here.
        { provide: StoreOrgResolver, useValue: { resolve: async () => null } },
      ],
    }).compile();
    service = module.get(ReturnsService);
  });

  const dto = (over: any = {}) => ({
    originalSaleId: 'sale-1',
    items: [{ lineItemId: 'li1', quantity: 1 }],
    refundMethod: 'cash' as const,
    ...over,
  });

  it('rejects an empty item list', async () => {
    await expect(service.createReturn('store-1', 'e1', dto({ items: [] }))).rejects.toThrow(BadRequestException);
  });

  it('rejects an invalid refund method', async () => {
    await expect(service.createReturn('store-1', 'e1', dto({ refundMethod: 'bitcoin' }))).rejects.toThrow(BadRequestException);
  });

  it('404 when the original sale does not exist', async () => {
    saleRepo.findOne.mockResolvedValue(null);
    await expect(service.createReturn('store-1', 'e1', dto())).rejects.toThrow(NotFoundException);
  });

  it('rejects a return exceeding the returnable quantity (incl. prior returns)', async () => {
    dataSource.query.mockResolvedValue([{ lid: 'li1', qty: '2' }]); // 2 already returned of 3
    await expect(service.createReturn('store-1', 'e1', dto({ items: [{ lineItemId: 'li1', quantity: 2 }] }))).rejects.toThrow(
      /dépasse le retournable/,
    );
  });

  it('creates a full-line refund: proportional amount, stock restored, audit logged', async () => {
    const res = await service.createReturn('store-1', 'e1', dto({ items: [{ lineItemId: 'li1', quantity: 2 }] }), 'Alice');
    // 2 of 3 units of a 1500 line → round(1500*2/3) = 1000
    expect(res.totalMinorUnits).toBe(1000);
    expect(res.type).toBe('refund');
    expect(res.remainingMinorUnits).toBe(0);
    expect(res.hashChainCurrent).toMatch(/^[0-9a-f]{64}$/);
    // stock restore UPDATE issued
    const updateCalls = qr.query.mock.calls.filter((c: any[]) => /UPDATE products/.test(c[0]));
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][1]).toEqual([2, 'p1', 'store-1']);
    expect(qr.commitTransaction).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'sale_returned' }));
  });

  it('store_credit return produces a reusable avoir with remaining = total', async () => {
    const res = await service.createReturn('store-1', 'e1', dto({ refundMethod: 'store_credit', items: [{ lineItemId: 'li2', quantity: 2 }] }));
    expect(res.type).toBe('store_credit');
    expect(res.status).toBe('active');
    expect(res.totalMinorUnits).toBe(600);
    expect(res.remainingMinorUnits).toBe(600);
    expect(res.code).toMatch(/^AV-/);
  });

  it('replays the cached credit note on idempotency-key reuse (no new transaction)', async () => {
    idemRepo.findOne.mockResolvedValue({ key: 'k1', responseBody: { id: 'cn-cached', code: 'AV-CACHED' } });
    const res = await service.createReturn('store-1', 'e1', dto(), 'Alice', 'k1');
    expect((res as any).code).toBe('AV-CACHED');
    expect(qr.startTransaction).not.toHaveBeenCalled();
  });

  describe('createReturnByTicket (offline-sync path)', () => {
    it('resolves the ticket + maps EAN to line items and creates the return', async () => {
      const res = await service.createReturnByTicket(
        'store-1', 'e1',
        { ticketNumber: 'T-000001', items: [{ ean: '111', quantity: 1 }], refundMethod: 'store_credit' },
        'Alice',
      );
      expect(res.type).toBe('store_credit');
      expect(res.totalMinorUnits).toBe(500); // 1 of 3 units of the 1500 line
    });

    it('404 when the ticket number is unknown', async () => {
      saleRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createReturnByTicket('store-1', 'e1', { ticketNumber: 'T-NOPE', items: [{ ean: '111', quantity: 1 }], refundMethod: 'cash' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an EAN that is not on the ticket', async () => {
      await expect(
        service.createReturnByTicket('store-1', 'e1', { ticketNumber: 'T-000001', items: [{ ean: 'ZZZ', quantity: 1 }], refundMethod: 'cash' }),
      ).rejects.toThrow(/absent du ticket/);
    });
  });

  describe('issueGiftCard', () => {
    it('issues a store_credit gift card with full balance and a generated code', async () => {
      const res = await service.issueGiftCard('store-1', 'e1', { amountMinorUnits: 5000 }, 'Alice');
      expect(res.type).toBe('store_credit');
      expect(res.origin).toBe('gift_card');
      expect(res.status).toBe('active');
      expect(res.totalMinorUnits).toBe(5000);
      expect(res.remainingMinorUnits).toBe(5000);
      expect(res.code).toMatch(/^GC-/);
      expect(res.originalSaleId).toBeNull();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'gift_card_issued' }));
    });

    it('uses a provided code (e.g. physical card serial), uppercased', async () => {
      const res = await service.issueGiftCard('store-1', 'e1', { amountMinorUnits: 2000, code: 'card-123' });
      expect(res.code).toBe('CARD-123');
    });

    it('rejects a non-positive amount', async () => {
      await expect(service.issueGiftCard('store-1', 'e1', { amountMinorUnits: 0 })).rejects.toThrow(BadRequestException);
    });

    it('replays the cached gift card on idempotency reuse', async () => {
      idemRepo.findOne.mockResolvedValue({ key: 'g1', responseBody: { id: 'gc-cached', code: 'GC-CACHED' } });
      const res = await service.issueGiftCard('store-1', 'e1', { amountMinorUnits: 1000 }, 'Alice', 'g1');
      expect((res as any).code).toBe('GC-CACHED');
      expect(qr.startTransaction).not.toHaveBeenCalled();
    });
  });

  describe('lookupSpendable', () => {
    it('returns spendable=true for an active store_credit with balance', async () => {
      cnRepo.findOne.mockResolvedValue({ code: 'AV-X', type: 'store_credit', status: 'active', remainingMinorUnits: 500 });
      const res = await service.lookupSpendable('av-x', 'store-1');
      expect(res.spendable).toBe(true);
      expect(res.remainingMinorUnits).toBe(500);
    });

    it('spendable=false for a refund-type or zero-balance note', async () => {
      cnRepo.findOne.mockResolvedValue({ code: 'AV-Y', type: 'refund', status: 'refunded', remainingMinorUnits: 0 });
      expect((await service.lookupSpendable('AV-Y', 'store-1')).spendable).toBe(false);
      cnRepo.findOne.mockResolvedValue({ code: 'AV-Z', type: 'store_credit', status: 'redeemed', remainingMinorUnits: 0 });
      expect((await service.lookupSpendable('AV-Z', 'store-1')).spendable).toBe(false);
    });

    it('404 when the code is unknown', async () => {
      cnRepo.findOne.mockResolvedValue(null);
      await expect(service.lookupSpendable('NOPE', 'store-1')).rejects.toThrow(NotFoundException);
    });
  });
});
