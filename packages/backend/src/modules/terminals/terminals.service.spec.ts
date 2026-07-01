import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';

import { TerminalsService } from './terminals.service';
import {
  PaymentTerminalEntity,
  TerminalDeviceType,
  TerminalStatus,
} from '../../database/entities/payment-terminal.entity';
import { StripeTerminalService } from '../stripe-terminal/stripe-terminal.service';

// PAQUET 247 — CRUD coverage lock for terminals.
// Pure DI-mocked spec: no DB, no Stripe network. Locks the branch logic
// (defaults, not-found, Stripe register success + graceful fallback,
// heartbeat field assignment, location reuse).

describe('TerminalsService', () => {
  let service: TerminalsService;
  let terminalRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let stripe: { registerReader: jest.Mock; createLocation: jest.Mock };

  beforeEach(async () => {
    terminalRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((x) => ({ ...x })),
      save: jest.fn((x) => Promise.resolve({ id: 'term-1', ...x })),
    };
    stripe = {
      registerReader: jest.fn(),
      createLocation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TerminalsService,
        { provide: getRepositoryToken(PaymentTerminalEntity), useValue: terminalRepo },
        { provide: StripeTerminalService, useValue: stripe },
      ],
    }).compile();

    service = module.get(TerminalsService);
  });

  describe('findAllByStore', () => {
    it('lists active terminals for the store, oldest first', async () => {
      terminalRepo.find.mockResolvedValue([{ id: 't' }]);
      const res = await service.findAllByStore('store-1');
      expect(res).toEqual([{ id: 't' }]);
      expect(terminalRepo.find).toHaveBeenCalledWith({
        where: { storeId: 'store-1', isActive: true },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('findById', () => {
    it('returns the terminal when found', async () => {
      terminalRepo.findOne.mockResolvedValue({ id: 't9' });
      await expect(service.findById('t9')).resolves.toEqual({ id: 't9' });
    });

    it('throws NotFoundException when absent', async () => {
      terminalRepo.findOne.mockResolvedValue(null);
      await expect(service.findById('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates with the default device type and no Stripe call when no registration code', async () => {
      const saved = await service.create('store-1', { label: 'Caisse 1' });
      expect(terminalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: 'store-1',
          label: 'Caisse 1',
          deviceType: TerminalDeviceType.WISEPAD_3,
          serialNumber: null,
          registrationCode: null,
        }),
      );
      expect(stripe.createLocation).not.toHaveBeenCalled();
      expect(stripe.registerReader).not.toHaveBeenCalled();
      expect(saved).toMatchObject({ label: 'Caisse 1' });
    });

    it('registers the reader with Stripe and marks it ONLINE when a code is given', async () => {
      terminalRepo.findOne.mockResolvedValue(null); // no existing location
      stripe.createLocation.mockResolvedValue({ id: 'loc_123' });
      stripe.registerReader.mockResolvedValue({ id: 'rdr_456' });

      const saved = await service.create('store-1', {
        label: 'Caisse 2',
        registrationCode: 'puppies-plug-code',
      });

      expect(stripe.createLocation).toHaveBeenCalledWith('Caisse 2', 'FR');
      expect(stripe.registerReader).toHaveBeenCalledWith('puppies-plug-code', 'Caisse 2', 'loc_123');
      expect(saved).toMatchObject({
        stripeLocationId: 'loc_123',
        stripeReaderId: 'rdr_456',
        status: TerminalStatus.ONLINE,
      });
    });

    it('still persists the terminal (without Stripe binding) when Stripe registration fails', async () => {
      terminalRepo.findOne.mockResolvedValue(null);
      stripe.createLocation.mockRejectedValue(new Error('stripe down'));

      const saved = await service.create('store-1', {
        label: 'Caisse 3',
        registrationCode: 'bad-code',
      });

      // Saved anyway, no throw; no reader binding
      expect(terminalRepo.save).toHaveBeenCalled();
      expect(saved.stripeReaderId).toBeUndefined();
      expect(saved.status).toBeUndefined();
    });
  });

  describe('update', () => {
    it('applies only the provided fields and saves', async () => {
      terminalRepo.findOne.mockResolvedValue({ id: 't1', label: 'Old', isActive: true });
      const saved = await service.update('t1', { label: 'New' });
      expect(saved).toMatchObject({ label: 'New', isActive: true });
    });
  });

  describe('heartbeat', () => {
    it('updates status/battery/firmware and stamps lastSeenAt', async () => {
      terminalRepo.findOne.mockResolvedValue({ id: 't1', status: TerminalStatus.OFFLINE });
      const saved = await service.heartbeat('t1', {
        status: TerminalStatus.ONLINE,
        batteryLevel: 88,
        firmwareVersion: '2.1.0',
      });
      expect(saved.status).toBe(TerminalStatus.ONLINE);
      expect(saved.batteryLevel).toBe(88);
      expect(saved.firmwareVersion).toBe('2.1.0');
      expect(saved.lastSeenAt).toBeInstanceOf(Date);
    });
  });

  describe('ensureStripeLocation', () => {
    it('reuses an existing store location without creating a new one', async () => {
      terminalRepo.findOne.mockResolvedValue({ stripeLocationId: 'loc_existing' });
      const id = await service.ensureStripeLocation('store-1', 'Boutique');
      expect(id).toBe('loc_existing');
      expect(stripe.createLocation).not.toHaveBeenCalled();
    });

    it('creates a new location when the store has none', async () => {
      terminalRepo.findOne.mockResolvedValue(null);
      stripe.createLocation.mockResolvedValue({ id: 'loc_new' });
      const id = await service.ensureStripeLocation('store-1', 'Boutique');
      expect(id).toBe('loc_new');
      expect(stripe.createLocation).toHaveBeenCalledWith('Boutique', 'FR');
    });
  });
});
