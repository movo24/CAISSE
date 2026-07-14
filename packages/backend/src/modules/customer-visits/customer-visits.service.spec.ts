import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

import { CustomerVisitsService } from './customer-visits.service';
import { CustomerVisitEntity } from '../../database/entities/customer-visit.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';

// PAQUET 262 — customer visits. DI-mocked. Locks: 5-min anti-duplicate scan,
// transactional insert (+ visit_count bump), and the secured frequency read
// (not-found → 404, cross-store non-admin → 403).

describe('CustomerVisitsService', () => {
  let service: CustomerVisitsService;
  let visitRepo: { createQueryBuilder: jest.Mock; find: jest.Mock };
  let customerRepo: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let qb: any;
  let mgr: { insert: jest.Mock; query: jest.Mock };

  beforeEach(async () => {
    qb = {
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      getOne: jest.fn(),
    };
    visitRepo = { createQueryBuilder: jest.fn(() => qb), find: jest.fn() };
    customerRepo = { findOne: jest.fn() };
    mgr = {
      insert: jest.fn().mockResolvedValue({ identifiers: [{ id: 'visit-1' }] }),
      query: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = { transaction: jest.fn((cb: any) => cb(mgr)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerVisitsService,
        { provide: getRepositoryToken(CustomerVisitEntity), useValue: visitRepo },
        { provide: getRepositoryToken(CustomerEntity), useValue: customerRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(CustomerVisitsService);
  });

  describe('recordVisit', () => {
    it('returns the existing visit (isDuplicate) when scanned again within 5 minutes', async () => {
      qb.getOne.mockResolvedValue({ id: 'recent-1' });
      const res = await service.recordVisit({ customerId: 'c1', storeId: 's1' });
      expect(res).toEqual({ visitId: 'recent-1', isDuplicate: true });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('inserts a new visit and bumps the customer counter when not a duplicate', async () => {
      qb.getOne.mockResolvedValue(null);
      const res = await service.recordVisit({ customerId: 'c1', storeId: 's1', purchaseAmountCents: 1990 });
      expect(res).toEqual({ visitId: 'visit-1', isDuplicate: false });
      expect(mgr.insert).toHaveBeenCalledWith(CustomerVisitEntity, expect.objectContaining({
        customerId: 'c1', storeId: 's1', purchaseAmountCents: 1990, source: 'POS_SCAN',
      }));
      expect(mgr.query).toHaveBeenCalledWith(expect.stringContaining('visit_count = visit_count + 1'), ['c1']);
    });
  });

  describe('getFrequency', () => {
    it('computes frequency from the recorded visit dates', async () => {
      visitRepo.find.mockResolvedValue([
        { visitedAt: new Date('2026-06-01T10:00:00Z') },
        { visitedAt: new Date('2026-06-08T10:00:00Z') },
      ]);
      const freq = await service.getFrequency('c1', new Date('2026-06-09T10:00:00Z'));
      expect(freq.visitCount).toBe(2);
    });
  });

  describe('getFrequencySecured', () => {
    it('throws NotFound when the customer does not exist', async () => {
      customerRepo.findOne.mockResolvedValue(null);
      await expect(service.getFrequencySecured('c1', 's1', 'manager')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Forbidden for a cross-store non-admin caller', async () => {
      customerRepo.findOne.mockResolvedValue({ id: 'c1', storeId: 'other-store' });
      await expect(service.getFrequencySecured('c1', 's1', 'cashier')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns frequency when the caller owns the customer store', async () => {
      customerRepo.findOne.mockResolvedValue({ id: 'c1', storeId: 's1' });
      visitRepo.find.mockResolvedValue([{ visitedAt: new Date('2026-06-01T10:00:00Z') }]);
      const freq = await service.getFrequencySecured('c1', 's1', 'manager');
      expect(freq.visitCount).toBe(1);
    });
  });
});
