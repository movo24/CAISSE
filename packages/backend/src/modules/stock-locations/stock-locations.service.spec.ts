import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { StockLocationsService } from './stock-locations.service';
import { StockLocationEntity } from '../../database/entities/stock-location.entity';
import { StockBalanceEntity } from '../../database/entities/stock-balance.entity';
import { StockMovementEntity } from '../../database/entities/stock-movement.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { AuditService } from '../audit/audit.service';

// PAQUET 252 — coverage for the location/balance CRUD guards (duplicate code,
// not-found, active-only listing, default balance). Transaction-heavy movement
// methods (receive/transfer/dispatch) are covered by dispatch-policy.spec.ts;
// here we lock the pure repo-branch logic with DI mocks (no DB).

describe('StockLocationsService — locations & balances', () => {
  let service: StockLocationsService;
  let locationRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let balanceRepo: { findOne: jest.Mock; find: jest.Mock };

  beforeEach(async () => {
    locationRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn((x) => Promise.resolve({ id: 'loc-1', ...x })),
    };
    balanceRepo = { findOne: jest.fn(), find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockLocationsService,
        { provide: getRepositoryToken(StockLocationEntity), useValue: locationRepo },
        { provide: getRepositoryToken(StockBalanceEntity), useValue: balanceRepo },
        { provide: getRepositoryToken(StockMovementEntity), useValue: {} },
        { provide: getRepositoryToken(ProductEntity), useValue: {} },
        { provide: DataSource, useValue: { query: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(StockLocationsService);
  });

  describe('createLocation', () => {
    it('rejects a duplicate code', async () => {
      locationRepo.findOne.mockResolvedValue({ id: 'x', code: 'CENTRAL' });
      await expect(
        service.createLocation({ name: 'C', code: 'CENTRAL', type: 'central' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(locationRepo.save).not.toHaveBeenCalled();
    });

    it('uppercases the code and defaults nullable fields on create', async () => {
      locationRepo.findOne.mockResolvedValue(null);
      const saved = await service.createLocation({ name: 'Boutique', code: 'shop-1', type: 'store' });
      expect(saved.code).toBe('SHOP-1');
      expect(saved.storeId).toBeNull();
      expect(saved.address).toBe('');
      expect(saved.type).toBe('store');
    });
  });

  describe('listLocations', () => {
    it('returns only active locations, ordered by type then name', async () => {
      locationRepo.find.mockResolvedValue([{ id: 'a' }]);
      await service.listLocations();
      expect(locationRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { type: 'ASC', name: 'ASC' },
      });
    });
  });

  describe('getLocation', () => {
    it('returns the location when found', async () => {
      locationRepo.findOne.mockResolvedValue({ id: 'loc-9' });
      await expect(service.getLocation('loc-9')).resolves.toEqual({ id: 'loc-9' });
    });
    it('throws NotFound when absent', async () => {
      locationRepo.findOne.mockResolvedValue(null);
      await expect(service.getLocation('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getBalance', () => {
    it('returns the stored quantity', async () => {
      balanceRepo.findOne.mockResolvedValue({ quantity: 42 });
      await expect(service.getBalance('p1', 'loc1')).resolves.toBe(42);
    });
    it('defaults to 0 when there is no balance row', async () => {
      balanceRepo.findOne.mockResolvedValue(null);
      await expect(service.getBalance('p1', 'loc1')).resolves.toBe(0);
    });
  });

  describe('findCentral', () => {
    it('queries for the active central location', async () => {
      locationRepo.findOne.mockResolvedValue({ id: 'c', type: 'central' });
      await service.findCentral();
      expect(locationRepo.findOne).toHaveBeenCalledWith({
        where: { type: 'central', isActive: true },
      });
    });
  });
});
