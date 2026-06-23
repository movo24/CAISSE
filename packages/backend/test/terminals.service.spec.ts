/**
 * TerminalsService characterization (POS payment terminal registry).
 *
 * EXECUTE-class: pure DB CRUD/queries over the PaymentTerminalEntity TypeORM
 * repo, plus one non-DB collaborator (StripeTerminalService) that is fully
 * mocked. The real card-capture / Stripe network logic lives in
 * StripeTerminalService and is NOT exercised here — we only assert that
 * TerminalsService WIRES to it correctly and persists the right local state,
 * including the documented "save the terminal even if Stripe registration
 * fails" fallback.
 *
 * Covered: store-scoped active listing + ordering, findById NotFound, create
 * defaults, create with Stripe success (binds reader/location/ONLINE), create
 * with Stripe failure (still persists, no binding), update (partial), heartbeat
 * (status/battery/firmware/lastSeenAt), ensureStripeLocation reuse vs creation.
 */
import './helpers/env-setup';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { NotFoundException } from '@nestjs/common';
import { createPgMemDataSource } from './helpers/pgmem';
import {
  PaymentTerminalEntity,
  TerminalStatus,
  TerminalDeviceType,
} from '../src/database/entities/payment-terminal.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { TerminalsService } from '../src/modules/terminals/terminals.service';

describe('TerminalsService — POS terminal registry', () => {
  let ds: DataSource;
  let repo: Repository<PaymentTerminalEntity>;
  let stripe: {
    registerReader: jest.Mock;
    createLocation: jest.Mock;
  };
  let svc: TerminalsService;

  const STORE_A = uuidv4();
  const STORE_B = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    // payment_terminals.store_id is a real FK → stores must exist first.
    await ds
      .getRepository(StoreEntity)
      .save([
        { id: STORE_A, name: 'Store A', isActive: true, currencyCode: 'EUR' },
        { id: STORE_B, name: 'Store B', isActive: true, currencyCode: 'EUR' },
      ] as any);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM payment_terminals');
    stripe = {
      registerReader: jest.fn(),
      createLocation: jest.fn(),
    };
    // Real constructor order: (terminalRepo, stripeTerminalService)
    svc = new TerminalsService(
      ds.getRepository(PaymentTerminalEntity) as any,
      stripe as any,
    );
    repo = ds.getRepository(PaymentTerminalEntity);
  });

  // ---- helper: seed a raw terminal row directly (bypasses Stripe path) ----
  async function seed(overrides: Partial<PaymentTerminalEntity> = {}) {
    const t = repo.create({
      storeId: STORE_A,
      label: 'Caisse 1',
      ...overrides,
    } as any);
    return repo.save(t as any);
  }

  describe('findAllByStore', () => {
    it('returns only ACTIVE terminals for the requested store, ordered by createdAt ASC', async () => {
      const a1 = await seed({ storeId: STORE_A, label: 'A-first' });
      const a2 = await seed({ storeId: STORE_A, label: 'A-second' });
      await seed({ storeId: STORE_A, label: 'A-inactive', isActive: false });
      await seed({ storeId: STORE_B, label: 'B-other' });

      // Backdate to make ordering deterministic regardless of insert timing.
      await ds.query('UPDATE payment_terminals SET created_at=$1 WHERE id=$2', [
        '2020-01-01T00:00:00.000Z',
        a1.id,
      ]);
      await ds.query('UPDATE payment_terminals SET created_at=$1 WHERE id=$2', [
        '2020-06-01T00:00:00.000Z',
        a2.id,
      ]);

      const list = await svc.findAllByStore(STORE_A);

      expect(list.map((t) => t.label)).toEqual(['A-first', 'A-second']);
      expect(list.every((t) => t.storeId === STORE_A)).toBe(true);
      expect(list.every((t) => t.isActive === true)).toBe(true);
    });

    it('returns an empty array for a store with no terminals', async () => {
      await seed({ storeId: STORE_A });
      expect(await svc.findAllByStore(STORE_B)).toEqual([]);
    });
  });

  describe('findById', () => {
    it('returns the terminal when it exists', async () => {
      const t = await seed({ label: 'Lookup-me' });
      const found = await svc.findById(t.id);
      expect(found.id).toBe(t.id);
      expect(found.label).toBe('Lookup-me');
    });

    it('throws NotFoundException for an unknown id', async () => {
      await expect(svc.findById(uuidv4())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('persists with defaults (WISEPAD_3, null serial/registration) when no Stripe code', async () => {
      const t = await svc.create(STORE_A, { label: 'New Caisse' });

      expect(t.id).toBeDefined();
      expect(t.storeId).toBe(STORE_A);
      expect(t.label).toBe('New Caisse');
      expect(t.deviceType).toBe(TerminalDeviceType.WISEPAD_3);
      expect(t.serialNumber).toBeNull();
      expect(t.registrationCode).toBeNull();
      // No Stripe binding attempted.
      expect(stripe.registerReader).not.toHaveBeenCalled();
      expect(stripe.createLocation).not.toHaveBeenCalled();
      expect(t.stripeReaderId ?? null).toBeNull();

      // Round-trips to DB.
      const reloaded = await repo.findOne({ where: { id: t.id } });
      expect(reloaded?.label).toBe('New Caisse');
    });

    it('honours an explicit deviceType and serialNumber', async () => {
      const t = await svc.create(STORE_A, {
        label: 'M2 Reader',
        deviceType: TerminalDeviceType.STRIPE_M2,
        serialNumber: 'SN-123',
      });
      expect(t.deviceType).toBe(TerminalDeviceType.STRIPE_M2);
      expect(t.serialNumber).toBe('SN-123');
    });

    it('with a registrationCode and working Stripe: binds reader+location and marks ONLINE', async () => {
      stripe.createLocation.mockResolvedValue({ id: 'loc_abc' });
      stripe.registerReader.mockResolvedValue({ id: 'rdr_xyz' });

      const t = await svc.create(STORE_A, {
        label: 'Bound Caisse',
        registrationCode: 'simulated-wpe-code',
      });

      expect(stripe.createLocation).toHaveBeenCalledWith('Bound Caisse', 'FR');
      expect(stripe.registerReader).toHaveBeenCalledWith(
        'simulated-wpe-code',
        'Bound Caisse',
        'loc_abc',
      );
      expect(t.stripeLocationId).toBe('loc_abc');
      expect(t.stripeReaderId).toBe('rdr_xyz');
      expect(t.status).toBe(TerminalStatus.ONLINE);

      const reloaded = await repo.findOne({ where: { id: t.id } });
      expect(reloaded?.stripeReaderId).toBe('rdr_xyz');
      expect(reloaded?.status).toBe(TerminalStatus.ONLINE);
    });

    it('with a registrationCode but FAILING Stripe: still persists the terminal WITHOUT binding', async () => {
      stripe.createLocation.mockRejectedValue(new Error('stripe down'));

      const t = await svc.create(STORE_A, {
        label: 'Resilient Caisse',
        registrationCode: 'bad-code',
      });

      // Saved despite the failure...
      expect(t.id).toBeDefined();
      const reloaded = await repo.findOne({ where: { id: t.id } });
      expect(reloaded).not.toBeNull();
      expect(reloaded?.label).toBe('Resilient Caisse');
      // ...but no Stripe binding and status stays the OFFLINE default.
      expect(reloaded?.stripeReaderId).toBeNull();
      expect(reloaded?.stripeLocationId).toBeNull();
      expect(reloaded?.status).toBe(TerminalStatus.OFFLINE);
      // registerReader never reached because createLocation threw first.
      expect(stripe.registerReader).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates only the provided fields (label) and leaves others intact', async () => {
      const t = await seed({ label: 'Old', isActive: true });
      const updated = await svc.update(t.id, { label: 'Renamed' });
      expect(updated.label).toBe('Renamed');
      expect(updated.isActive).toBe(true);
    });

    it('can deactivate via isActive=false', async () => {
      const t = await seed({ isActive: true });
      const updated = await svc.update(t.id, { isActive: false });
      expect(updated.isActive).toBe(false);
      const reloaded = await repo.findOne({ where: { id: t.id } });
      expect(reloaded?.isActive).toBe(false);
    });

    it('throws NotFoundException when updating an unknown id', async () => {
      await expect(
        svc.update(uuidv4(), { label: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('heartbeat', () => {
    it('updates status, lastSeenAt, batteryLevel and firmwareVersion', async () => {
      const t = await seed({ status: TerminalStatus.OFFLINE });
      const before = Date.now();

      const updated = await svc.heartbeat(t.id, {
        status: TerminalStatus.ONLINE,
        batteryLevel: 87,
        firmwareVersion: '1.4.2',
      });

      expect(updated.status).toBe(TerminalStatus.ONLINE);
      expect(Number(updated.batteryLevel)).toBe(87);
      expect(updated.firmwareVersion).toBe('1.4.2');
      expect(updated.lastSeenAt).toBeInstanceOf(Date);
      expect(updated.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('updates status and lastSeenAt even when battery/firmware omitted', async () => {
      const t = await seed({
        status: TerminalStatus.ONLINE,
        batteryLevel: 50,
        firmwareVersion: '1.0.0',
      });

      const updated = await svc.heartbeat(t.id, {
        status: TerminalStatus.ERROR,
      });

      expect(updated.status).toBe(TerminalStatus.ERROR);
      // Untouched fields preserved.
      expect(Number(updated.batteryLevel)).toBe(50);
      expect(updated.firmwareVersion).toBe('1.0.0');
      expect(updated.lastSeenAt).toBeInstanceOf(Date);
    });

    it('throws NotFoundException for an unknown id', async () => {
      await expect(
        svc.heartbeat(uuidv4(), { status: TerminalStatus.ONLINE }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('ensureStripeLocation', () => {
    it('reuses an existing stripeLocationId when a terminal for the store already has one', async () => {
      await seed({ storeId: STORE_A, stripeLocationId: 'loc_existing' });

      const locId = await svc.ensureStripeLocation(STORE_A, 'Store A');

      expect(locId).toBe('loc_existing');
      // No new location created.
      expect(stripe.createLocation).not.toHaveBeenCalled();
    });

    it('creates a new Stripe location (FR) when no terminal for the store has one', async () => {
      stripe.createLocation.mockResolvedValue({ id: 'loc_new' });

      const locId = await svc.ensureStripeLocation(STORE_A, 'Store A');

      expect(stripe.createLocation).toHaveBeenCalledWith('Store A', 'FR');
      expect(locId).toBe('loc_new');
    });

    it('creates a new location when the store has terminals but none carry a location', async () => {
      await seed({ storeId: STORE_A, stripeLocationId: null });
      stripe.createLocation.mockResolvedValue({ id: 'loc_fresh' });

      const locId = await svc.ensureStripeLocation(STORE_A, 'Store A');

      expect(stripe.createLocation).toHaveBeenCalledTimes(1);
      expect(locId).toBe('loc_fresh');
    });
  });
});
