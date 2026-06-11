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

/**
 * E1 — Idempotency on POS writes (NF525): a replayed offline-sync request must
 * NEVER create a second sale (or re-void). The idempotency key is the durable
 * client queue id; the server stores the response transactionally and replays it.
 */
describe('SalesService — idempotency (E1)', () => {
  let service: SalesService;
  let idempotencyRepo: { findOne: jest.Mock };
  let queryRunner: any;

  const createDto: any = {
    items: [{ ean: '111', quantity: 1 }],
    payments: [{ method: 'cash', amountMinorUnits: 500 }],
  };

  beforeEach(async () => {
    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      isReleased: false,
      manager: { save: jest.fn(async (_e: any, s: any) => s), findOne: jest.fn(), insert: jest.fn() },
      query: jest.fn(),
    };
    const dataSource = { createQueryRunner: () => queryRunner } as unknown as DataSource;
    idempotencyRepo = { findOne: jest.fn() };
    const noop = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: getRepositoryToken(SaleEntity), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(SaleLineItemEntity), useValue: noop },
        { provide: getRepositoryToken(SalePaymentEntity), useValue: noop },
        { provide: getRepositoryToken(IdempotencyKeyEntity), useValue: idempotencyRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: ProductsService, useValue: { findByEan: jest.fn() } },
        { provide: CustomersService, useValue: noop },
        { provide: PromotionsService, useValue: noop },
        { provide: AuditService, useValue: { log: jest.fn() } },
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

  describe('createSale', () => {
    it('returns the cached sale on replay WITHOUT opening a transaction or creating a new sale', async () => {
      idempotencyRepo.findOne.mockResolvedValue({
        key: 'ticket:abc',
        responseBody: { id: 'sale-1', ticketNumber: 'T-000001', totalMinorUnits: 500 },
      });

      const res: any = await service.createSale('store-1', 'emp-1', createDto, {}, 'ticket:abc');

      expect(res.id).toBe('sale-1');
      expect(res.ticketNumber).toBe('T-000001');
      expect(res.jackpotResult).toBeNull();
      expect(res.stockAlerts).toEqual([]);
      // No transaction, no product resolution — the replay short-circuits everything.
      expect(queryRunner.connect).not.toHaveBeenCalled();
      expect(queryRunner.startTransaction).not.toHaveBeenCalled();
    });

    it('rejects an idempotency key longer than 64 chars', async () => {
      await expect(
        service.createSale('store-1', 'emp-1', createDto, {}, 'x'.repeat(65)),
      ).rejects.toThrow(BadRequestException);
      expect(idempotencyRepo.findOne).not.toHaveBeenCalled();
    });

    it('does not consult the idempotency store when no key is provided', async () => {
      // No key → goes straight to normal validation (which fails on empty after
      // we stub products to return nothing). The point: idempotency is skipped.
      idempotencyRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createSale('store-1', 'emp-1', { items: [], payments: [] } as any),
      ).rejects.toThrow(BadRequestException);
      expect(idempotencyRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('voidSale', () => {
    it('returns the cached result on replay instead of throwing "already voided"', async () => {
      idempotencyRepo.findOne.mockResolvedValue({
        key: 'void:xyz',
        responseBody: { id: 'sale-9', status: 'voided', ticketNumber: 'T-000009' },
      });
      const findOneSpy = jest.spyOn(service, 'findOne');

      const res: any = await service.voidSale('sale-9', 'emp-1', 'store-1', 'admin', 100, undefined, 'void:xyz');

      expect(res.id).toBe('sale-9');
      expect(res.status).toBe('voided');
      // The replay must NOT re-read the sale nor open a transaction.
      expect(findOneSpy).not.toHaveBeenCalled();
      expect(queryRunner.connect).not.toHaveBeenCalled();
    });
  });
});
