import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

import { JackpotService } from './jackpot.service';
import { JackpotConfigEntity } from '../../database/entities/jackpot-config.entity';
import { JackpotWinEntity } from '../../database/entities/jackpot-win.entity';
import { OccupancyService } from '../occupancy/occupancy.service';

// PAQUET 259 — jackpot config CRUD + daily usage. DI-mocked. Locks: active-only
// config lookup, not-found/forbidden guards, immutable storeId/id on update, and
// today's win counts. Roll/decision logic lives in jackpot-decision.spec.

describe('JackpotService — config & usage', () => {
  let service: JackpotService;
  let configRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let winRepo: { count: jest.Mock };

  beforeEach(async () => {
    configRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'cfg-1', ...x })),
    };
    winRepo = { count: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JackpotService,
        { provide: getRepositoryToken(JackpotConfigEntity), useValue: configRepo },
        { provide: getRepositoryToken(JackpotWinEntity), useValue: winRepo },
        { provide: OccupancyService, useValue: { getLiveCount: jest.fn() } },
      ],
    }).compile();

    service = module.get(JackpotService);
  });

  describe('getConfig / getConfigOrFail', () => {
    it('looks up the active config for the store', async () => {
      configRepo.findOne.mockResolvedValue({ id: 'cfg-1' });
      await service.getConfig('s1');
      expect(configRepo.findOne).toHaveBeenCalledWith({ where: { storeId: 's1', isActive: true } });
    });
    it('getConfigOrFail throws NotFound when there is none', async () => {
      configRepo.findOne.mockResolvedValue(null);
      await expect(service.getConfigOrFail('s1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createConfig', () => {
    it('refuses to create when a config already exists (use update)', async () => {
      configRepo.findOne.mockResolvedValue({ id: 'cfg-1' });
      await expect(service.createConfig('s1', {})).rejects.toBeInstanceOf(ForbiddenException);
      expect(configRepo.save).not.toHaveBeenCalled();
    });
    it('creates and persists when none exists, forcing the storeId', async () => {
      configRepo.findOne.mockResolvedValue(null);
      const saved = await service.createConfig('s1', { megaJackpotQuotaPerDay: 1 } as any);
      expect(saved).toMatchObject({ storeId: 's1', megaJackpotQuotaPerDay: 1 });
    });
  });

  describe('updateConfig', () => {
    it('applies the patch but never lets storeId/id be overwritten', async () => {
      configRepo.findOne.mockResolvedValue({ id: 'cfg-1', storeId: 's1', smallWinQuotaPerDay: 5 });
      const saved = await service.updateConfig('s1', {
        smallWinQuotaPerDay: 9, storeId: 'HACK', id: 'HACK',
      } as any);
      expect(saved.storeId).toBe('s1');
      expect(saved.id).toBe('cfg-1');
      expect(saved.smallWinQuotaPerDay).toBe(9);
    });
  });

  describe('getUsageToday', () => {
    it('returns the mega/small win counts for today', async () => {
      winRepo.count.mockResolvedValueOnce(1).mockResolvedValueOnce(4);
      const usage = await service.getUsageToday('s1');
      expect(usage).toEqual({ megaWon: 1, smallWon: 4 });
      expect(winRepo.count).toHaveBeenCalledTimes(2);
    });
  });
});
