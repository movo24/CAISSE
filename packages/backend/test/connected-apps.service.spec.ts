/**
 * ConnectedAppsService — CRUD over connected_apps with organization-relation
 * validation. Pure DB logic (pg-mem), no network / payment / fiscal surface:
 *   - findAll: only isActive rows for the org, ordered by name ASC
 *   - findOne: NotFound when missing
 *   - create: rejects unknown organization (invalidRelation), persists otherwise
 *   - update: NotFound; re-validates org only when it actually changes; partial merge
 *   - deactivate: flips isActive false (removes the row from findAll)
 */
import './helpers/env-setup';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { ConnectedAppsService } from '../src/modules/connected-apps/connected-apps.service';
import { ConnectedAppEntity } from '../src/database/entities/connected-app.entity';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { BusinessError } from '../src/common/errors/business-error';

describe('ConnectedAppsService (pg-mem)', () => {
  let ds: DataSource;
  let svc: ConnectedAppsService;
  let appRepo: ReturnType<DataSource['getRepository']>;
  let orgRepo: ReturnType<DataSource['getRepository']>;

  let ORG: string;

  const seedOrg = async (name = 'Org'): Promise<string> => {
    const o = await orgRepo.save(orgRepo.create({ name }) as any);
    return (o as any).id;
  };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    appRepo = ds.getRepository(ConnectedAppEntity);
    orgRepo = ds.getRepository(OrganizationEntity);
    svc = new ConnectedAppsService(appRepo as any, orgRepo as any);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM connected_apps');
    await ds.query('DELETE FROM organizations');
    ORG = await seedOrg();
  });

  describe('create', () => {
    it('persists an app when the organization exists, with defaults', async () => {
      const saved = await svc.create({
        organizationId: ORG,
        name: 'Uber Eats',
      } as any);

      expect(saved.id).toBeDefined();
      expect(saved.name).toBe('Uber Eats');
      expect(saved.organizationId).toBe(ORG);
      // column defaults applied by the DB
      expect(saved.isActive).toBe(true);

      const row = await appRepo.findOne({ where: { id: saved.id } as any });
      expect(row).not.toBeNull();
    });

    it('rejects creation when the organization does not exist (invalidRelation, 400)', async () => {
      const missing = uuidv4();
      await expect(
        svc.create({ organizationId: missing, name: 'Ghost' } as any),
      ).rejects.toMatchObject({ code: 'INVALID_RELATION' });

      // nothing persisted
      const count = await appRepo.count();
      expect(count).toBe(0);
    });
  });

  describe('findOne', () => {
    it('returns the app by id', async () => {
      const created = await svc.create({ organizationId: ORG, name: 'A' } as any);
      const found = await svc.findOne(created.id);
      expect(found.id).toBe(created.id);
      expect(found.name).toBe('A');
    });

    it('throws NotFound for an unknown id', async () => {
      const err = await svc.findOne(uuidv4()).catch((e) => e);
      expect(err).toBeInstanceOf(BusinessError);
      expect((err as BusinessError).code).toBe('CONNECTEDAPP_NOT_FOUND');
    });
  });

  describe('findAll', () => {
    it('returns only active apps for the org, ordered by name ASC', async () => {
      await svc.create({ organizationId: ORG, name: 'Charlie' } as any);
      await svc.create({ organizationId: ORG, name: 'Alpha' } as any);
      const bravo = await svc.create({
        organizationId: ORG,
        name: 'Bravo',
      } as any);
      // deactivate Bravo → must be excluded
      await svc.deactivate(bravo.id);

      const list = await svc.findAll(ORG);
      expect(list.map((a) => a.name)).toEqual(['Alpha', 'Charlie']);
    });

    it('scopes results to the given organization', async () => {
      const otherOrg = await seedOrg('Other');
      await svc.create({ organizationId: ORG, name: 'Mine' } as any);
      await svc.create({ organizationId: otherOrg, name: 'Theirs' } as any);

      const list = await svc.findAll(ORG);
      expect(list.map((a) => a.name)).toEqual(['Mine']);
    });

    it('returns an empty array when the org has no apps', async () => {
      const list = await svc.findAll(ORG);
      expect(list).toEqual([]);
    });
  });

  describe('update', () => {
    it('throws NotFound when the app does not exist', async () => {
      const err = await svc
        .update(uuidv4(), { name: 'x' } as any)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BusinessError);
      expect((err as BusinessError).code).toBe('CONNECTEDAPP_NOT_FOUND');
    });

    it('merges partial fields without clobbering unspecified ones', async () => {
      const created = await svc.create({
        organizationId: ORG,
        name: 'Old Name',
        description: 'keep me',
      } as any);

      const updated = await svc.update(created.id, {
        name: 'New Name',
      } as any);

      expect(updated.name).toBe('New Name');
      expect(updated.description).toBe('keep me');
      expect(updated.organizationId).toBe(ORG);
    });

    it('rejects moving the app to a non-existent organization', async () => {
      const created = await svc.create({ organizationId: ORG, name: 'A' } as any);
      const missing = uuidv4();

      await expect(
        svc.update(created.id, { organizationId: missing } as any),
      ).rejects.toMatchObject({ code: 'INVALID_RELATION' });

      // unchanged
      const row = await appRepo.findOne({ where: { id: created.id } as any });
      expect((row as any).organizationId).toBe(ORG);
    });

    it('moves the app to a different existing organization', async () => {
      const created = await svc.create({ organizationId: ORG, name: 'A' } as any);
      const otherOrg = await seedOrg('Dest');

      const updated = await svc.update(created.id, {
        organizationId: otherOrg,
      } as any);
      expect(updated.organizationId).toBe(otherOrg);
    });

    it('does NOT re-validate the org when organizationId is unchanged', async () => {
      const created = await svc.create({ organizationId: ORG, name: 'A' } as any);
      // pass the same org id explicitly — guard short-circuits (=== app.organizationId)
      const spy = jest.spyOn(orgRepo as any, 'findOne');
      const updated = await svc.update(created.id, {
        organizationId: ORG,
        name: 'B',
      } as any);
      expect(updated.name).toBe('B');
      // findOne on orgRepo must not be invoked for an unchanged org
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('deactivate', () => {
    it('flips isActive to false and removes the app from findAll', async () => {
      const created = await svc.create({ organizationId: ORG, name: 'A' } as any);
      expect(created.isActive).toBe(true);

      const deactivated = await svc.deactivate(created.id);
      expect(deactivated.isActive).toBe(false);

      const list = await svc.findAll(ORG);
      expect(list.find((a) => a.id === created.id)).toBeUndefined();

      // row still exists (soft deactivate, not deletion)
      const row = await appRepo.findOne({ where: { id: created.id } as any });
      expect(row).not.toBeNull();
      expect((row as any).isActive).toBe(false);
    });

    it('throws NotFound when deactivating an unknown app', async () => {
      const err = await svc.deactivate(uuidv4()).catch((e) => e);
      expect(err).toBeInstanceOf(BusinessError);
      expect((err as BusinessError).code).toBe('CONNECTEDAPP_NOT_FOUND');
    });
  });
});
