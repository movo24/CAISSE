import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { SalesService } from './sales.service';
import { SaleEntity } from '../../database/entities/sale.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { PosMachineEntity } from '../../database/entities/pos-machine.entity';
import { AuditService } from '../audit/audit.service';
import { ProductsService } from '../products/products.service';
import { CustomersService } from '../customers/customers.service';
import { PromotionsService } from '../promotions/promotions.service';
import { StockService } from '../stock/stock.service';
import { JackpotService } from '../jackpot/jackpot.service';
import { TimewinService } from '../timewin/timewin.service';
import { RealtimeService } from '../../common/realtime/realtime.service';

/**
 * Partie B — barrière d'enrôlement machine sur la création de vente.
 *
 * Règle : une NOUVELLE vente est bloquée tant que la machine émettrice n'est
 * pas `approved`, MAIS uniquement si le magasin applique l'enrôlement
 * (`store.enrollmentEnforced = true`). Le gate tourne AVANT la validation
 * d'entrée : on prouve qu'il « laisse passer » en atteignant la validation
 * (BadRequestException sur panier vide) et qu'il « bloque » via
 * ForbiddenException.
 */
describe('SalesService — barrière enrôlement (Partie B)', () => {
  const STORE = 'store-1';
  const emptyDto: any = { items: [], payments: [{ method: 'cash', amountMinorUnits: 1 }] };

  async function build(opts: {
    withRepos: boolean;
    enforced?: boolean;
    machine?: Partial<PosMachineEntity> | null;
  }): Promise<SalesService> {
    const noop = {};
    const providers: any[] = [
      SalesService,
      { provide: getRepositoryToken(SaleEntity), useValue: { findOne: jest.fn() } },
      { provide: getRepositoryToken(EmployeeEntity), useValue: { findOne: jest.fn() } },
      { provide: getRepositoryToken(SaleLineItemEntity), useValue: noop },
      { provide: getRepositoryToken(SalePaymentEntity), useValue: noop },
      { provide: getRepositoryToken(IdempotencyKeyEntity), useValue: { findOne: jest.fn().mockResolvedValue(null) } },
      { provide: DataSource, useValue: { createQueryRunner: () => ({}) } },
      { provide: ProductsService, useValue: { findByEan: jest.fn() } },
      { provide: CustomersService, useValue: noop },
      { provide: PromotionsService, useValue: noop },
      { provide: AuditService, useValue: { log: jest.fn() } },
      { provide: StockService, useValue: noop },
      { provide: JackpotService, useValue: noop },
      { provide: TimewinService, useValue: noop },
      { provide: RealtimeService, useValue: { emit: jest.fn() } },
    ];
    if (opts.withRepos) {
      providers.push({
        provide: getRepositoryToken(StoreEntity),
        useValue: { findOne: jest.fn().mockResolvedValue({ id: STORE, enrollmentEnforced: opts.enforced ?? false }) },
      });
      providers.push({
        provide: getRepositoryToken(PosMachineEntity),
        useValue: { findOne: jest.fn().mockResolvedValue(opts.machine ?? null) },
      });
    }
    const module: TestingModule = await Test.createTestingModule({ providers }).compile();
    return module.get(SalesService);
  }

  it('magasin sans enrôlement appliqué → gate inerte (atteint la validation d’entrée)', async () => {
    const service = await build({ withRepos: true, enforced: false });
    await expect(service.createSale(STORE, 'emp', emptyDto, {}, undefined, null, 'MC-1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('enrôlement appliqué + machine approuvée → laisse passer (validation d’entrée)', async () => {
    const service = await build({
      withRepos: true,
      enforced: true,
      machine: { machineId: 'MC-OK', storeId: STORE, status: 'approved' },
    });
    await expect(service.createSale(STORE, 'emp', emptyDto, {}, undefined, null, 'MC-OK'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('enrôlement appliqué + aucune machine déclarée → vente BLOQUÉE (Forbidden)', async () => {
    const service = await build({ withRepos: true, enforced: true, machine: null });
    await expect(service.createSale(STORE, 'emp', emptyDto, {}, undefined, null, undefined))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enrôlement appliqué + machine pending → vente BLOQUÉE (Forbidden)', async () => {
    const service = await build({
      withRepos: true,
      enforced: true,
      machine: { machineId: 'MC-P', storeId: STORE, status: 'pending' },
    });
    await expect(service.createSale(STORE, 'emp', emptyDto, {}, undefined, null, 'MC-P'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('repos non injectés (tests hérités) → gate inerte, aucun blocage', async () => {
    const service = await build({ withRepos: false });
    await expect(service.createSale(STORE, 'emp', emptyDto, {}, undefined, null, 'MC-X'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
