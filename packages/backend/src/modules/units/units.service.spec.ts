import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnitsService } from './units.service';
import { UnitEntity } from '../../database/entities/unit.entity';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { BusinessError } from '../../common/errors/business-error';
import { HttpStatus } from '@nestjs/common';

describe('UnitsService', () => {
  let service: UnitsService;
  let unitRepo: any;
  let orgRepo: any;

  const mockOrg: Partial<OrganizationEntity> = {
    id: 'org-1',
    name: 'Corp Alpha',
    isActive: true,
  };

  const mockUnit: Partial<UnitEntity> = {
    id: 'unit-1',
    name: 'Unit Retail',
    organizationId: 'org-1',
    type: 'retail',
    isActive: true,
  };

  beforeEach(async () => {
    unitRepo = {
      find: jest.fn().mockResolvedValue([mockUnit]),
      findOne: jest.fn(),
      create: jest.fn((dto) => ({ ...dto, id: 'unit-new' })),
      save: jest.fn((entity) => Promise.resolve({ ...mockUnit, ...entity })),
    };

    orgRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnitsService,
        { provide: getRepositoryToken(UnitEntity), useValue: unitRepo },
        { provide: getRepositoryToken(OrganizationEntity), useValue: orgRepo },
      ],
    }).compile();

    service = module.get<UnitsService>(UnitsService);
  });

  describe('create', () => {
    it('should create a unit with valid org', async () => {
      orgRepo.findOne.mockResolvedValue(mockOrg);
      unitRepo.findOne.mockResolvedValue(null); // no duplicate

      const dto = { name: 'Unit B', organizationId: 'org-1', type: 'warehouse' };
      const result = await service.create(dto as any);

      expect(unitRepo.create).toHaveBeenCalledWith(dto);
      expect(unitRepo.save).toHaveBeenCalled();
    });

    it('should throw 400 when org not found', async () => {
      orgRepo.findOne.mockResolvedValue(null);

      const dto = { name: 'Unit X', organizationId: 'org-missing' };

      await expect(service.create(dto as any)).rejects.toThrow(BusinessError);
    });

    it('should throw 400 when org is deactivated', async () => {
      orgRepo.findOne.mockResolvedValue({ ...mockOrg, isActive: false });

      const dto = { name: 'Unit Y', organizationId: 'org-1' };

      await expect(service.create(dto as any)).rejects.toThrow(BusinessError);
    });

    it('should throw 409 on duplicate name within same org', async () => {
      orgRepo.findOne.mockResolvedValue(mockOrg);
      unitRepo.findOne.mockResolvedValue(mockUnit); // duplicate exists

      const dto = { name: 'Unit Retail', organizationId: 'org-1' };

      await expect(service.create(dto as any)).rejects.toThrow(BusinessError);
      try {
        await service.create(dto as any);
      } catch (e: any) {
        expect(e.code).toBe('UNIT_NAME_ALREADY_EXISTS');
        expect(e.getStatus()).toBe(HttpStatus.CONFLICT);
      }
    });
  });

  describe('findOne', () => {
    it('should return unit when found', async () => {
      unitRepo.findOne.mockResolvedValue(mockUnit);
      const result = await service.findOne('unit-1');
      expect(result).toEqual(mockUnit);
    });

    it('should throw 404 when not found', async () => {
      unitRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('unit-nope')).rejects.toThrow(BusinessError);
    });
  });

  describe('deactivate', () => {
    it('should set isActive=false', async () => {
      unitRepo.findOne.mockResolvedValue({ ...mockUnit });

      const result = await service.deactivate('unit-1');
      expect(result.isActive).toBe(false);
    });
  });
});
