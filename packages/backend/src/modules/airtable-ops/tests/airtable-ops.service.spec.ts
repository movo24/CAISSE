import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { AirtableOpsService } from '../airtable-ops.service';
import { AirtableOpsSyncService } from '../airtable-ops.sync.service';
import { AirtableOpsConfig } from '../airtable-ops.config';
import { AirtableOperationEntity } from '../../../database/entities/airtable-operation.entity';
import { AirtableSyncLogEntity } from '../../../database/entities/airtable-sync-log.entity';
import { ProductEntity } from '../../../database/entities/product.entity';

const makeOp = (
  overrides: Partial<AirtableOperationEntity> = {},
): AirtableOperationEntity =>
  ({
    id: 'op-uuid-1',
    entityType: 'product',
    entityId: 'prod-uuid-1',
    storeId: 'store-uuid-1',
    field: 'isActive',
    currentValue: true,
    proposedValue: false,
    riskLevel: 'medium',
    status: 'pending',
    sourceAirtableRecordId: 'recXXX',
    sourceAirtableTableId: 'tblXXX',
    reviewedBy: null,
    reviewedAt: null,
    appliedAt: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AirtableOperationEntity);

describe('AirtableOpsService', () => {
  let service: AirtableOpsService;
  let operationRepo: jest.Mocked<Repository<AirtableOperationEntity>>;
  let productRepo: jest.Mocked<Repository<ProductEntity>>;

  beforeEach(async () => {
    const mockQueryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AirtableOpsService,
        {
          provide: getRepositoryToken(AirtableOperationEntity),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
          },
        },
        {
          provide: getRepositoryToken(AirtableSyncLogEntity),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(ProductEntity),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: AirtableOpsConfig,
          useValue: { enabled: true },
        },
        {
          provide: AirtableOpsSyncService,
          useValue: {
            exportProducts: jest.fn().mockResolvedValue(undefined),
            importProductSuggestions: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(AirtableOpsService);
    operationRepo = module.get(getRepositoryToken(AirtableOperationEntity));
    productRepo = module.get(getRepositoryToken(ProductEntity));
  });

  // ── getOperation ─────────────────────────────────────────────────────────

  describe('getOperation', () => {
    it('returns the operation when found', async () => {
      const op = makeOp();
      operationRepo.findOne.mockResolvedValue(op);
      await expect(service.getOperation('op-uuid-1')).resolves.toEqual(op);
    });

    it('throws NotFoundException when not found', async () => {
      operationRepo.findOne.mockResolvedValue(null);
      await expect(service.getOperation('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── approveOperation ─────────────────────────────────────────────────────

  describe('approveOperation', () => {
    it('approves a pending medium-risk operation with manager role', async () => {
      const op = makeOp({ status: 'pending', riskLevel: 'medium' });
      operationRepo.findOne.mockResolvedValue(op);
      operationRepo.save.mockResolvedValue({ ...op, status: 'approved' } as any);

      const result = await service.approveOperation('op-uuid-1', 'employee-1', 1);
      expect(result.status).toBe('approved');
      expect(operationRepo.save).toHaveBeenCalled();
    });

    it('throws ForbiddenException when role is insufficient for high-risk', async () => {
      const op = makeOp({ status: 'pending', riskLevel: 'high' });
      operationRepo.findOne.mockResolvedValue(op);

      await expect(
        service.approveOperation('op-uuid-1', 'employee-1', 1), // manager=1, need admin=2
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when operation is not pending', async () => {
      const op = makeOp({ status: 'applied' });
      operationRepo.findOne.mockResolvedValue(op);

      await expect(service.approveOperation('op-uuid-1', 'emp', 2)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── rejectOperation ──────────────────────────────────────────────────────

  describe('rejectOperation', () => {
    it('rejects a pending operation with a reason', async () => {
      const op = makeOp({ status: 'pending' });
      operationRepo.findOne.mockResolvedValue(op);
      operationRepo.save.mockResolvedValue({ ...op, status: 'rejected' } as any);

      const result = await service.rejectOperation('op-uuid-1', 'manager-1', 'Not needed');
      expect(result.status).toBe('rejected');
    });
  });

  // ── applyOperation ───────────────────────────────────────────────────────

  describe('applyOperation', () => {
    it('applies an approved medium-risk operation to the product', async () => {
      const op = makeOp({
        status: 'approved',
        riskLevel: 'medium',
        entityType: 'product',
        entityId: 'prod-uuid-1',
        field: 'isActive',
        proposedValue: false,
      });
      const product = { id: 'prod-uuid-1', isActive: true } as ProductEntity;

      operationRepo.findOne.mockResolvedValue(op);
      productRepo.findOne.mockResolvedValue(product);
      productRepo.update.mockResolvedValue({ affected: 1 } as any);
      operationRepo.save.mockResolvedValue({ ...op, status: 'applied' } as any);

      const result = await service.applyOperation('op-uuid-1', 2);
      expect(result.status).toBe('applied');
      expect(productRepo.update).toHaveBeenCalledWith('prod-uuid-1', { isActive: false });
    });

    it('throws ForbiddenException for high-risk when applier role < 2', async () => {
      const op = makeOp({ status: 'approved', riskLevel: 'high' });
      operationRepo.findOne.mockResolvedValue(op);

      await expect(service.applyOperation('op-uuid-1', 1)).rejects.toThrow(ForbiddenException);
    });

    it('marks operation as failed and rethrows when product not found', async () => {
      const op = makeOp({ status: 'approved', riskLevel: 'medium' });
      operationRepo.findOne.mockResolvedValue(op);
      productRepo.findOne.mockResolvedValue(null);
      operationRepo.save.mockResolvedValue({ ...op, status: 'failed' } as any);

      await expect(service.applyOperation('op-uuid-1', 2)).rejects.toThrow(NotFoundException);
      expect(operationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' }),
      );
    });
  });

  // ── triggerManualSync ────────────────────────────────────────────────────

  describe('triggerManualSync', () => {
    it('returns { queued: true } when module is enabled', async () => {
      const result = await service.triggerManualSync();
      expect(result).toEqual({ queued: true });
    });

    it('returns { queued: false } when module is disabled', async () => {
      // Temporarily disable
      (service as any).config = { enabled: false };
      const result = await service.triggerManualSync();
      expect(result).toEqual({ queued: false });
    });
  });
});
