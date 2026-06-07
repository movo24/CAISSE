import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

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

/**
 * Sensitive-action audit on voidSale (Option 2): the void operation is
 * enriched with metadata and audited POST-COMMIT, non-blocking.
 *
 * We do NOT test a fabricated `refund` — no such action exists in the codebase;
 * voidSale (annulation) is the closest real operation. A true refund remains a
 * separate future feature.
 */
describe('SalesService — voidSale audit (Option 2)', () => {
  let service: SalesService;
  let audit: { log: jest.Mock };
  let queryRunner: any;

  const sale: Partial<SaleEntity> = {
    id: 'sale-1',
    storeId: 'store-1',
    ticketNumber: 'T-000123',
    totalMinorUnits: 4500,
    status: 'completed' as any,
    lineItems: [{ productId: 'p1', quantity: 2 } as any],
  };

  beforeEach(async () => {
    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: { save: jest.fn(async (_e: any, s: any) => s) },
      query: jest.fn(),
    };
    const dataSource = { createQueryRunner: () => queryRunner } as unknown as DataSource;
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const noop = {};
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: getRepositoryToken(SaleEntity), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(SaleLineItemEntity), useValue: noop },
        { provide: getRepositoryToken(SalePaymentEntity), useValue: noop },
        { provide: getRepositoryToken(IdempotencyKeyEntity), useValue: { findOne: jest.fn() } },
        { provide: DataSource, useValue: dataSource },
        { provide: ProductsService, useValue: noop },
        { provide: CustomersService, useValue: noop },
        { provide: PromotionsService, useValue: noop },
        { provide: AuditService, useValue: audit },
        { provide: StockService, useValue: noop },
        { provide: JackpotService, useValue: noop },
        { provide: TimewinService, useValue: noop },
      ],
    }).compile();

    service = module.get(SalesService);
    // Fresh copy each call — voidSale mutates sale.status, so a shared object
    // would make a second void see "already voided".
    jest.spyOn(service, 'findOne').mockImplementation(async () =>
      JSON.parse(JSON.stringify(sale)) as SaleEntity,
    );
  });

  it('audits sale_voided post-commit with enriched metadata (amount, reason, role, source)', async () => {
    await service.voidSale('sale-1', 'emp-1', 'store-1', 'admin', 100, 'client parti');

    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0];
    expect(entry.action).toBe('sale_voided');
    expect(entry.entityId).toBe('sale-1');
    expect(entry.details.totalMinorUnits).toBe(4500);
    expect(entry.details.reason).toBe('client parti');
    expect(entry.details.employeeRole).toBe('admin');
    expect(entry.details.source).toBe('pos_void');
  });

  it('reason is null when not provided (no sensitive/invented data)', async () => {
    await service.voidSale('sale-1', 'emp-1', 'store-1', 'admin', 100);
    const entry = audit.log.mock.calls[0][0];
    expect(entry.details.reason).toBeNull();
  });

  it('does NOT let an audit failure block or undo the committed void', async () => {
    audit.log.mockRejectedValueOnce(new Error('audit down'));
    const result = await service.voidSale('sale-1', 'emp-1', 'store-1', 'admin', 100);

    // The void still succeeds; commit happened before audit; no rollback.
    expect(result).toBeDefined();
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });
});
