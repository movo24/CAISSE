/**
 * Étage 4 — the account WRITE surface (devices + preferences). Separate from the
 * GET-only cockpit router (INV-1 untouched there). Ownership mirrors the 404
 * doctrine: a foreign/unknown token is NOT FOUND, indistinguishable.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { NotifyDeviceTokenEntity } from '../src/database/entities/notify-device-token.entity';
import { NotifyPreferenceEntity } from '../src/database/entities/notify-preference.entity';
import { NotifyAccountController } from '../src/modules/notify/notify-account.controller';

describe('Étage 4 — notify account write surface', () => {
  let ds: DataSource;
  let controller: NotifyAccountController;
  const ALICE = uuidv4();
  const BOB = uuidv4();
  const reqOf = (employeeId: string) => ({ user: { employeeId } });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    controller = new NotifyAccountController(
      ds.getRepository(NotifyDeviceTokenEntity),
      ds.getRepository(NotifyPreferenceEntity),
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('registers a device for the authenticated employee', async () => {
    const r = await controller.register(reqOf(ALICE), { token: 'tok-alice-1', platform: 'ios' });
    expect(r.status).toBe('registered');
    const row = await ds.getRepository(NotifyDeviceTokenEntity).findOne({ where: { token: 'tok-alice-1' } });
    expect(row).toMatchObject({ employeeId: ALICE, platform: 'ios', isActive: true });
  });

  it('re-registering an existing token CLAIMS it for the latest registrant (handover/re-login)', async () => {
    const r = await controller.register(reqOf(BOB), { token: 'tok-alice-1', platform: 'android' });
    expect(r.status).toBe('reactivated');
    const row = await ds.getRepository(NotifyDeviceTokenEntity).findOne({ where: { token: 'tok-alice-1' } });
    expect(row).toMatchObject({ employeeId: BOB, platform: 'android', isActive: true });
    expect(await ds.getRepository(NotifyDeviceTokenEntity).count({ where: { token: 'tok-alice-1' } })).toBe(1);
  });

  it('ADVERSE — missing token or bad platform → 400', async () => {
    await expect(controller.register(reqOf(ALICE), { token: '', platform: 'ios' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.register(reqOf(ALICE), { token: 'x', platform: 'blackberry' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('DECISIVE — unregistering a FOREIGN token → 404 (indistinguishable from unknown)', async () => {
    await controller.register(reqOf(ALICE), { token: 'tok-alice-2', platform: 'web' });
    await expect(controller.unregister(reqOf(BOB), 'tok-alice-2')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.unregister(reqOf(BOB), 'tok-does-not-exist')).rejects.toBeInstanceOf(NotFoundException);
    // the owner can:
    const r = await controller.unregister(reqOf(ALICE), 'tok-alice-2');
    expect(r.status).toBe('unregistered');
    const row = await ds.getRepository(NotifyDeviceTokenEntity).findOne({ where: { token: 'tok-alice-2' } });
    expect(row!.isActive).toBe(false);
  });

  it('preferences upsert — quiet hours are USER data (none by default, both-or-neither)', async () => {
    const r = await controller.setPreferences(reqOf(ALICE), { enabled: true, quietStartHour: 22, quietEndHour: 7 });
    expect(r).toMatchObject({ employeeId: ALICE, enabled: true, quietStartHour: 22, quietEndHour: 7 });
    const cleared = await controller.setPreferences(reqOf(ALICE), { enabled: false });
    expect(cleared).toMatchObject({ enabled: false, quietStartHour: null, quietEndHour: null });
  });

  it('GET preferences — returns the saved row, or the engine defaults when none exists', async () => {
    const fresh = await controller.getPreferences(reqOf(uuidv4()));
    expect(fresh).toMatchObject({ enabled: true, quietStartHour: null, quietEndHour: null });
    await controller.setPreferences(reqOf(BOB), { enabled: true, quietStartHour: 21, quietEndHour: 6 });
    const saved = await controller.getPreferences(reqOf(BOB));
    expect(saved).toMatchObject({ employeeId: BOB, quietStartHour: 21, quietEndHour: 6 });
  });

  it('ADVERSE — invalid quiet hours → 400 (out of range, or set alone)', async () => {
    await expect(controller.setPreferences(reqOf(ALICE), { quietStartHour: 25, quietEndHour: 7 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.setPreferences(reqOf(ALICE), { quietStartHour: 22 })).rejects.toBeInstanceOf(BadRequestException);
  });
});
