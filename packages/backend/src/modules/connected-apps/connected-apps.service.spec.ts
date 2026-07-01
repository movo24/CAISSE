import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ConnectedAppsService } from './connected-apps.service';
import { ConnectedAppEntity } from '../../database/entities/connected-app.entity';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { BusinessError } from '../../common/errors/business-error';

// PAQUET 247 — CRUD coverage lock for connected-apps.
// Pure DI-mocked spec: no DB, no runtime. Locks the branch logic
// (org existence validation, not-found, active-only listing, deactivate).

describe('ConnectedAppsService', () => {
  let service: ConnectedAppsService;
  let appRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let orgRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    appRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'app-1', ...x })),
    };
    orgRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectedAppsService,
        { provide: getRepositoryToken(ConnectedAppEntity), useValue: appRepo },
        { provide: getRepositoryToken(OrganizationEntity), useValue: orgRepo },
      ],
    }).compile();

    service = module.get(ConnectedAppsService);
  });

  describe('findAll', () => {
    it('lists only active apps for the organization, ordered by name', async () => {
      appRepo.find.mockResolvedValue([{ id: 'a' }]);
      const res = await service.findAll('org-1');
      expect(res).toEqual([{ id: 'a' }]);
      expect(appRepo.find).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', isActive: true },
        order: { name: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    it('returns the app when found', async () => {
      appRepo.findOne.mockResolvedValue({ id: 'app-9' });
      await expect(service.findOne('app-9')).resolves.toEqual({ id: 'app-9' });
    });

    it('throws a 404 BusinessError when not found', async () => {
      appRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toMatchObject({
        constructor: BusinessError,
        code: 'CONNECTEDAPP_NOT_FOUND',
      });
    });
  });

  describe('create', () => {
    it('rejects when the referenced organization does not exist', async () => {
      orgRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create({ organizationId: 'ghost', name: 'X' } as any),
      ).rejects.toMatchObject({ code: 'INVALID_RELATION' });
      expect(appRepo.save).not.toHaveBeenCalled();
    });

    it('creates and saves when the organization exists', async () => {
      orgRepo.findOne.mockResolvedValue({ id: 'org-1' });
      const dto = { organizationId: 'org-1', name: 'Airtable' } as any;
      const saved = await service.create(dto);
      expect(appRepo.create).toHaveBeenCalledWith(dto);
      expect(appRepo.save).toHaveBeenCalled();
      expect(saved).toMatchObject({ name: 'Airtable' });
    });
  });

  describe('update', () => {
    it('validates the new organization only when it actually changes', async () => {
      appRepo.findOne.mockResolvedValue({ id: 'app-1', organizationId: 'org-1', name: 'A' });
      orgRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('app-1', { organizationId: 'org-2' } as any),
      ).rejects.toMatchObject({ code: 'INVALID_RELATION' });
    });

    it('does not re-validate the org when unchanged, and persists the patch', async () => {
      appRepo.findOne.mockResolvedValue({ id: 'app-1', organizationId: 'org-1', name: 'A' });
      const saved = await service.update('app-1', { name: 'B' } as any);
      expect(orgRepo.findOne).not.toHaveBeenCalled();
      expect(saved).toMatchObject({ name: 'B' });
    });
  });

  describe('deactivate', () => {
    it('flips isActive to false and saves (soft delete)', async () => {
      appRepo.findOne.mockResolvedValue({ id: 'app-1', name: 'A', isActive: true });
      const saved = await service.deactivate('app-1');
      expect(saved.isActive).toBe(false);
      expect(appRepo.save).toHaveBeenCalled();
    });
  });
});
