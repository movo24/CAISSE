import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrganizationsService } from './organizations.service';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { UnitEntity } from '../../database/entities/unit.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { BusinessError } from '../../common/errors/business-error';
import { HttpStatus } from '@nestjs/common';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let orgRepo: any;
  let unitRepo: any;
  let storeRepo: any;

  const mockOrg: Partial<OrganizationEntity> = {
    id: 'org-1',
    name: 'Corp Alpha',
    isActive: true,
  };

  beforeEach(async () => {
    orgRepo = {
      find: jest.fn().mockResolvedValue([mockOrg]),
      findOne: jest.fn(),
      create: jest.fn((dto) => ({ ...dto, id: 'org-new' })),
      save: jest.fn((entity) => Promise.resolve({ ...mockOrg, ...entity })),
    };

    unitRepo = {
      update: jest.fn().mockResolvedValue({ affected: 2 }),
    };

    storeRepo = {
      update: jest.fn().mockResolvedValue({ affected: 3 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: getRepositoryToken(OrganizationEntity), useValue: orgRepo },
        { provide: getRepositoryToken(UnitEntity), useValue: unitRepo },
        { provide: getRepositoryToken(StoreEntity), useValue: storeRepo },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
  });

  describe('create', () => {
    it('should create an organization with unique name', async () => {
      orgRepo.findOne.mockResolvedValue(null); // no duplicate

      const result = await service.create({ name: 'New Corp' } as any);

      expect(orgRepo.create).toHaveBeenCalledWith({ name: 'New Corp' });
      expect(orgRepo.save).toHaveBeenCalled();
      expect(result.name).toBeDefined();
    });

    it('should throw 409 on duplicate name', async () => {
      orgRepo.findOne.mockResolvedValue(mockOrg); // duplicate exists

      await expect(
        service.create({ name: 'Corp Alpha' } as any),
      ).rejects.toThrow(BusinessError);

      try {
        await service.create({ name: 'Corp Alpha' } as any);
      } catch (e: any) {
        expect(e.code).toBe('ORGANIZATION_NAME_ALREADY_EXISTS');
        expect(e.getStatus()).toBe(HttpStatus.CONFLICT);
      }
    });
  });

  describe('findOne', () => {
    it('should return org when found', async () => {
      orgRepo.findOne.mockResolvedValue(mockOrg);

      const result = await service.findOne('org-1');
      expect(result).toEqual(mockOrg);
    });

    it('should throw 404 when not found', async () => {
      orgRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('org-nope')).rejects.toThrow(BusinessError);
    });
  });

  describe('update', () => {
    it('should update org fields', async () => {
      orgRepo.findOne
        .mockResolvedValueOnce(mockOrg) // findOne in update
        .mockResolvedValue(null); // uniqueness check

      const result = await service.update('org-1', { name: 'Renamed Corp' } as any);

      expect(result.name).toBe('Renamed Corp');
    });

    it('should throw 409 when renaming to an existing name', async () => {
      orgRepo.findOne
        .mockResolvedValueOnce(mockOrg) // findOne
        .mockResolvedValueOnce({ id: 'org-other', name: 'Taken Name' }); // uniqueness check

      await expect(
        service.update('org-1', { name: 'Taken Name' } as any),
      ).rejects.toThrow(BusinessError);
    });
  });

  describe('deactivate', () => {
    it('should deactivate org and cascade to units and stores', async () => {
      orgRepo.findOne.mockResolvedValue({ ...mockOrg });

      const result = await service.deactivate('org-1');

      expect(result.isActive).toBe(false);
      // Verify cascade
      expect(unitRepo.update).toHaveBeenCalledWith(
        { organizationId: 'org-1', isActive: true },
        { isActive: false },
      );
      expect(storeRepo.update).toHaveBeenCalledWith(
        { organizationId: 'org-1', isActive: true },
        { isActive: false },
      );
    });
  });
});
