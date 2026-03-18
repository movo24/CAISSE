import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StoresService } from './stores.service';
import { StoreEntity } from '../../database/entities/store.entity';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { UnitEntity } from '../../database/entities/unit.entity';
import { BusinessError } from '../../common/errors/business-error';
import { HttpStatus } from '@nestjs/common';

describe('StoresService', () => {
  let service: StoresService;
  let storeRepo: any;
  let orgRepo: any;
  let unitRepo: any;

  const mockOrg: Partial<OrganizationEntity> = {
    id: 'org-1',
    name: 'Test Corp',
    isActive: true,
  };

  const mockUnit: Partial<UnitEntity> = {
    id: 'unit-1',
    name: 'Unit A',
    organizationId: 'org-1',
    isActive: true,
  };

  const mockStore: Partial<StoreEntity> = {
    id: 'store-1',
    name: 'Boutique Paris',
    storeCode: 'MAG-001',
    isActive: true,
    isArchived: false,
    organizationId: 'org-1',
    unitId: 'unit-1',
  };

  beforeEach(async () => {
    storeRepo = {
      find: jest.fn().mockResolvedValue([mockStore]),
      findOne: jest.fn(),
      create: jest.fn((dto) => ({ ...dto, id: 'store-new' })),
      save: jest.fn((entity) => Promise.resolve({ ...mockStore, ...entity })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    orgRepo = {
      findOne: jest.fn(),
    };

    unitRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoresService,
        { provide: getRepositoryToken(StoreEntity), useValue: storeRepo },
        { provide: getRepositoryToken(OrganizationEntity), useValue: orgRepo },
        { provide: getRepositoryToken(UnitEntity), useValue: unitRepo },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue({
              connect: jest.fn(),
              startTransaction: jest.fn(),
              query: jest.fn(),
              commitTransaction: jest.fn(),
              rollbackTransaction: jest.fn(),
              release: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
  });

  // ── CREATE ──────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a store with valid data', async () => {
      storeRepo.findOne.mockResolvedValue(null); // no duplicate
      orgRepo.findOne.mockResolvedValue(mockOrg);
      unitRepo.findOne.mockResolvedValue(mockUnit);

      const dto = {
        name: 'Boutique Lyon',
        storeCode: 'MAG-002',
        organizationId: 'org-1',
        unitId: 'unit-1',
      };

      const result = await service.create(dto as any);

      expect(storeRepo.create).toHaveBeenCalledWith(dto);
      expect(storeRepo.save).toHaveBeenCalled();
      expect(result.name).toBeDefined();
    });

    it('should create a store without optional fields', async () => {
      const dto = { name: 'Boutique Minimale' };

      const result = await service.create(dto as any);

      expect(storeRepo.create).toHaveBeenCalledWith(dto);
      expect(storeRepo.save).toHaveBeenCalled();
    });

    it('should throw 409 on duplicate storeCode', async () => {
      storeRepo.findOne.mockResolvedValue(mockStore); // duplicate exists

      const dto = { name: 'Another Store', storeCode: 'MAG-001' };

      await expect(service.create(dto as any)).rejects.toThrow(BusinessError);
      await expect(service.create(dto as any)).rejects.toMatchObject({
        code: 'STORE_STORECODE_ALREADY_EXISTS',
      });
    });

    it('should throw 400 when organization does not exist', async () => {
      storeRepo.findOne.mockResolvedValue(null); // no duplicate storeCode
      orgRepo.findOne.mockResolvedValue(null); // org not found

      const dto = { name: 'Store X', organizationId: 'org-missing' };

      await expect(service.create(dto as any)).rejects.toThrow(BusinessError);
    });

    it('should throw 400 when unit does not exist', async () => {
      storeRepo.findOne.mockResolvedValue(null);
      orgRepo.findOne.mockResolvedValue(mockOrg);
      unitRepo.findOne.mockResolvedValue(null); // unit not found

      const dto = { name: 'Store Y', organizationId: 'org-1', unitId: 'unit-missing' };

      await expect(service.create(dto as any)).rejects.toThrow(BusinessError);
    });

    it('should throw 400 when unit does not belong to organization', async () => {
      storeRepo.findOne.mockResolvedValue(null);
      orgRepo.findOne.mockResolvedValue(mockOrg);
      unitRepo.findOne.mockResolvedValue({ ...mockUnit, organizationId: 'org-other' });

      const dto = { name: 'Store Z', organizationId: 'org-1', unitId: 'unit-1' };

      await expect(service.create(dto as any)).rejects.toThrow(BusinessError);
    });
  });

  // ── FIND ────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return a store when found', async () => {
      storeRepo.findOne.mockResolvedValue(mockStore);

      const result = await service.findOne('store-1');

      expect(result).toEqual(mockStore);
    });

    it('should throw 404 when store not found', async () => {
      storeRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('store-nope')).rejects.toThrow(BusinessError);
      try {
        await service.findOne('store-nope');
      } catch (e: any) {
        expect(e.code).toBe('STORE_NOT_FOUND');
        expect(e.getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });

  // ── ARCHIVE / ACTIVATE / DEACTIVATE ─────────────────────────────

  describe('archive', () => {
    it('should set isArchived=true and isActive=false', async () => {
      storeRepo.findOne.mockResolvedValue({ ...mockStore });

      const result = await service.archive('store-1', 'admin-1');

      expect(result.isArchived).toBe(true);
      expect(result.isActive).toBe(false);
    });
  });

  describe('activate', () => {
    it('should set isActive=true for non-archived store', async () => {
      storeRepo.findOne.mockResolvedValue({
        ...mockStore,
        isActive: false,
        isArchived: false,
      });

      const result = await service.activate('store-1');

      expect(result.isActive).toBe(true);
    });

    it('should throw when store is archived', async () => {
      storeRepo.findOne.mockResolvedValue({
        ...mockStore,
        isActive: false,
        isArchived: true,
      });

      await expect(service.activate('store-1')).rejects.toThrow(BusinessError);
      try {
        await service.activate('store-1');
      } catch (e: any) {
        expect(e.code).toBe('STORE_ARCHIVED');
        expect(e.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      }
    });
  });

  describe('deactivate', () => {
    it('should set isActive=false', async () => {
      storeRepo.findOne.mockResolvedValue({ ...mockStore });

      const result = await service.deactivate('store-1');

      expect(result.isActive).toBe(false);
    });
  });

  // ── UPDATE ──────────────────────────────────────────────────────

  describe('update', () => {
    it('should forbid updating another store', async () => {
      await expect(
        service.update('store-other', { name: 'Hack' }, 'store-1'),
      ).rejects.toThrow(BusinessError);
    });

    it('should update own store', async () => {
      storeRepo.findOne.mockResolvedValue({ ...mockStore });

      const result = await service.update('store-1', { name: 'Updated' }, 'store-1');

      expect(storeRepo.update).toHaveBeenCalledWith('store-1', { name: 'Updated' });
    });
  });
});
