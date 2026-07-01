import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';

import { MobileAuthService } from './mobile-auth.service';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { LoyaltyCardService } from '../loyalty-card/loyalty-card.service';
import { CouponService } from '../coupon/coupon.service';

// PAQUET 266 — Wesley Club (mobile) auth guards. DI-mocked. Locks the input
// validation + credential guards that run BEFORE any token issuance: invalid
// email, weak password, duplicate account, unknown user, wrong password.
// Token building itself is covered by mobile-tokens.spec.

describe('MobileAuthService — register/login guards', () => {
  let service: MobileAuthService;
  let customerRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    customerRepo = { findOne: jest.fn(), create: jest.fn((x) => x), save: jest.fn((x) => Promise.resolve({ id: 'c1', ...x })) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MobileAuthService,
        { provide: getRepositoryToken(CustomerEntity), useValue: customerRepo },
        { provide: LoyaltyCardService, useValue: { createCard: jest.fn() } },
        { provide: CouponService, useValue: { issueWelcome: jest.fn() } },
      ],
    }).compile();
    service = module.get(MobileAuthService);
  });

  describe('register', () => {
    it('rejects an invalid email (no @)', async () => {
      await expect(service.register({ email: 'nope', password: 'longenough1' }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(customerRepo.findOne).not.toHaveBeenCalled();
    });

    it('rejects a password shorter than 8 chars', async () => {
      await expect(service.register({ email: 'a@b.com', password: 'short' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a duplicate account (409)', async () => {
      customerRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(service.register({ email: 'a@b.com', password: 'longenough1' }))
        .rejects.toBeInstanceOf(ConflictException);
      expect(customerRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('rejects an unknown / password-less account', async () => {
      customerRepo.findOne.mockResolvedValue(null);
      await expect(service.login('a@b.com', 'whatever1')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong password (bcrypt mismatch)', async () => {
      customerRepo.findOne.mockResolvedValue({
        id: 'c1', passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
      });
      await expect(service.login('a@b.com', 'wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
