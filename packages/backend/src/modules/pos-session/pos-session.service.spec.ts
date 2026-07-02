import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { PosSessionService } from './pos-session.service';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { StoreOrgResolver } from '../integration/store-org-resolver';

// PAQUET 253 — POS session lifecycle guards (γ invariant: one active session per
// (store, terminal); cross-store/cross-employee close forbidden). DI-mocked, no DB.
// The activity outbox write is best-effort (swallowed) — it must never block a
// session open/close, which these tests also confirm.

describe('PosSessionService', () => {
  let service: PosSessionService;
  let repo: { findOne: jest.Mock; save: jest.Mock };
  let outbox: { insert: jest.Mock };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      save: jest.fn((s) => Promise.resolve({ id: 'sess-1', openedAt: new Date(), ...s })),
    };
    outbox = { insert: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PosSessionService,
        { provide: getRepositoryToken(PosSessionEntity), useValue: repo },
        { provide: getRepositoryToken(IntegrationEventEntity), useValue: outbox },
        { provide: StoreOrgResolver, useValue: { resolve: jest.fn().mockResolvedValue('org-1') } },
        // P312 — getSessionCashSummary aggregates via DataSource.query (mocked here).
        { provide: DataSource, useValue: { query: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    service = module.get(PosSessionService);
  });

  describe('openSession — guards', () => {
    it('requires storeId', async () => {
      await expect(service.openSession('', 'e1', {}, { terminalId: 't1' })).rejects.toBeInstanceOf(BadRequestException);
    });
    it('requires employeeId', async () => {
      await expect(service.openSession('s1', '', {}, { terminalId: 't1' })).rejects.toBeInstanceOf(BadRequestException);
    });
    it('requires terminalId (sessions are terminal-bound)', async () => {
      await expect(service.openSession('s1', 'e1', {}, {})).rejects.toBeInstanceOf(BadRequestException);
    });
    it('refuses a second active session on the same terminal (409)', async () => {
      repo.findOne.mockResolvedValue({ id: 'existing', isActive: true });
      await expect(
        service.openSession('s1', 'e1', {}, { terminalId: 't1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    });
    it('maps a unique-violation (23505) on insert to the same 409', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.save.mockRejectedValue({ code: '23505', message: 'duplicate key' });
      await expect(
        service.openSession('s1', 'e1', {}, { terminalId: 't1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
    it('opens and returns the session; outbox write is best-effort (non-blocking)', async () => {
      repo.findOne.mockResolvedValue(null);
      const saved = await service.openSession('s1', 'e1', { employeeName: 'Jean' }, { terminalId: 't1' });
      expect(saved).toMatchObject({ storeId: 's1', employeeId: 'e1', terminalId: 't1', isActive: true });
    });
    it('still opens even if the outbox insert throws (swallowed)', async () => {
      repo.findOne.mockResolvedValue(null);
      outbox.insert.mockRejectedValue(new Error('outbox down'));
      await expect(
        service.openSession('s1', 'e1', {}, { terminalId: 't1' }),
      ).resolves.toMatchObject({ isActive: true });
    });
  });

  describe('closeSession — guards', () => {
    it('throws NotFound when the session does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.closeSession('x', 's1', 'e1')).rejects.toBeInstanceOf(NotFoundException);
    });
    it('refuses a cross-store close', async () => {
      repo.findOne.mockResolvedValue({ id: 'x', storeId: 'other', employeeId: 'e1', isActive: true });
      await expect(service.closeSession('x', 's1', 'e1')).rejects.toBeInstanceOf(BadRequestException);
    });
    it('refuses a cross-employee close', async () => {
      repo.findOne.mockResolvedValue({ id: 'x', storeId: 's1', employeeId: 'other', isActive: true });
      await expect(service.closeSession('x', 's1', 'e1')).rejects.toBeInstanceOf(BadRequestException);
    });
    it('refuses closing an already-closed session (409)', async () => {
      repo.findOne.mockResolvedValue({ id: 'x', storeId: 's1', employeeId: 'e1', isActive: false });
      await expect(service.closeSession('x', 's1', 'e1')).rejects.toBeInstanceOf(ConflictException);
    });
    it('closes an active session: isActive=false + closedAt stamped', async () => {
      repo.findOne.mockResolvedValue({ id: 'x', storeId: 's1', employeeId: 'e1', isActive: true });
      const saved = await service.closeSession('x', 's1', 'e1');
      expect(saved.isActive).toBe(false);
      expect(saved.closedAt).toBeInstanceOf(Date);
    });
  });

  describe('findActiveForTerminal', () => {
    it('requires terminalId', async () => {
      await expect(service.findActiveForTerminal('s1', '')).rejects.toBeInstanceOf(BadRequestException);
    });
    it('returns the active session for the terminal', async () => {
      repo.findOne.mockResolvedValue({ id: 'act' });
      await expect(service.findActiveForTerminal('s1', 't1')).resolves.toEqual({ id: 'act' });
      expect(repo.findOne).toHaveBeenCalledWith({ where: { storeId: 's1', terminalId: 't1', isActive: true } });
    });
  });
});
