import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CustomersService } from './customers.service';
import { NotificationService } from '../../common/messaging/notification.service';
import { CustomerEntity } from '../../database/entities/customer.entity';

describe('CustomersService', () => {
  let service: CustomersService;
  let customerRepo: any;

  const mockCustomer: Partial<CustomerEntity> = {
    id: 'cust-1',
    storeId: 'store-1',
    firstName: 'Marie',
    lastName: 'Martin',
    phone: '0601020304',
    email: 'marie@test.fr',
    qrCode: 'CLI-ABCD1234',
    loyaltyPoints: 100,
    isFirstPurchase: true,
    isVerified: false,
  };

  beforeEach(async () => {
    customerRepo = {
      create: jest.fn().mockImplementation((data) => ({ ...data, id: 'cust-new' })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockCustomer], 1]),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        {
          provide: getRepositoryToken(CustomerEntity),
          useValue: customerRepo,
        },
        {
          provide: NotificationService,
          useValue: { notify: jest.fn().mockResolvedValue({ ok: false, skipped: true, provider: 'none' }) },
        },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  // ─────────────────────────────────────────────────────────────
  // create
  // ─────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create customer with QR code and OTP', async () => {
      const result = await service.create({
        firstName: 'Paul',
        lastName: 'Durand',
        storeId: 'store-1',
      });

      expect(result.customer).toBeDefined();
      expect(result.qrCodeDataUrl).toContain('data:image/png');
      // Security (M301/D12): the OTP is NEVER returned by the API; it lives in the store.
      expect((result as any).otpCode).toBeUndefined();
      expect((service as any).otpStore.get(result.customer.id).code).toMatch(/^\d{6}$/);
      expect(customerRepo.create).toHaveBeenCalled();
      expect(customerRepo.save).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // findOne — tenant isolation
  // ─────────────────────────────────────────────────────────────

  describe('findOne (tenant isolation)', () => {
    it('should return customer when storeId matches', async () => {
      customerRepo.findOne.mockResolvedValue(mockCustomer);

      const result = await service.findOne('cust-1', 'store-1');
      expect(result.id).toBe('cust-1');
      expect(customerRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'cust-1', storeId: 'store-1' },
      });
    });

    it('should throw NotFoundException when storeId does not match', async () => {
      customerRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('cust-1', 'other-store')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // findOneForStore — tenant isolation
  // ─────────────────────────────────────────────────────────────

  describe('findOneForStore', () => {
    it('should return customer for correct store', async () => {
      customerRepo.findOne.mockResolvedValue(mockCustomer);

      const result = await service.findOneForStore('cust-1', 'store-1');
      expect(result.id).toBe('cust-1');
    });

    it('should throw ForbiddenException for wrong store', async () => {
      customerRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findOneForStore('cust-1', 'other-store'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // findAll — pagination
  // ─────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const result = await service.findAll('store-1', { page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(10);
      expect(result.meta.total).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });

    it('should use default pagination when no options', async () => {
      const result = await service.findAll('store-1');

      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(50);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // OTP verification
  // ─────────────────────────────────────────────────────────────

  describe('verifyOtp', () => {
    it('should verify with correct OTP code', async () => {
      // First create to generate OTP
      const created = await service.create({
        firstName: 'Test',
        lastName: 'User',
        storeId: 'store-1',
      });

      customerRepo.findOne.mockResolvedValue({
        ...created.customer,
        isVerified: false,
      });

      const result = await service.verifyOtp(
        created.customer.id,
        (service as any).otpStore.get(created.customer.id).code,
        'store-1',
      );

      expect(result.isVerified).toBe(true);
    });

    it('should reject wrong OTP code', async () => {
      const created = await service.create({
        firstName: 'Test',
        lastName: 'User',
        storeId: 'store-1',
      });

      customerRepo.findOne.mockResolvedValue({
        ...created.customer,
        isVerified: false,
      });

      await expect(
        service.verifyOtp(created.customer.id, '000000', 'store-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return customer if already verified', async () => {
      customerRepo.findOne.mockResolvedValue({
        ...mockCustomer,
        isVerified: true,
      });

      const result = await service.verifyOtp('cust-1', '123456', 'store-1');
      expect(result.isVerified).toBe(true);
    });

    it('should lock out after 5 failed OTP attempts', async () => {
      const created = await service.create({
        firstName: 'Locked',
        lastName: 'Out',
        storeId: 'store-1',
      });
      // Capture the correct OTP now (the store entry may be cleared after lock-out).
      const correctOtp = (service as any).otpStore.get(created.customer.id).code;

      customerRepo.findOne.mockResolvedValue({
        ...created.customer,
        isVerified: false,
      });

      // 5 wrong attempts
      for (let i = 0; i < 5; i++) {
        await expect(
          service.verifyOtp(created.customer.id, '000000', 'store-1'),
        ).rejects.toThrow(BadRequestException);
      }

      // 6th attempt — even with correct code, OTP should be deleted
      await expect(
        service.verifyOtp(created.customer.id, correctOtp, 'store-1'),
      ).rejects.toThrow(/Too many failed OTP attempts/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // addLoyaltyPoints — tenant isolation
  // ─────────────────────────────────────────────────────────────

  describe('addLoyaltyPoints', () => {
    it('should add points for correct store', async () => {
      customerRepo.findOne.mockResolvedValue({ ...mockCustomer, loyaltyPoints: 100 });

      const result = await service.addLoyaltyPoints('cust-1', 50, 'store-1');
      expect(result.loyaltyPoints).toBe(150);
    });

    it('should throw for wrong store', async () => {
      customerRepo.findOne.mockResolvedValue(null);

      await expect(
        service.addLoyaltyPoints('cust-1', 50, 'other-store'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('anonymize (M302 — GDPR erasure)', () => {
    it('scrubs PII, neutralises qr_code, sets markers, keeps non-PII aggregates', async () => {
      const cust: any = {
        id: 'c1abc999', firstName: 'Jean', lastName: 'Dupont', phone: '+33600000000',
        email: 'jean@example.com', passwordHash: 'hash', qrCode: 'CLI-ABC', loyaltyPoints: 120,
        visitCount: 7, storeId: 's1', anonymizedAt: null, deletedAt: null,
      };
      customerRepo.findOne.mockResolvedValue(cust);
      const res = await service.anonymize('c1abc999', 'emp-1');
      expect(res.firstName).toBe('');
      expect(res.lastName).toBe('');
      expect(res.phone).toBeNull();
      expect(res.email).toBeNull();
      expect(res.passwordHash).toBeNull();
      expect(res.qrCode).toBe('ANON-c1abc999');
      expect(res.anonymizedAt).toBeInstanceOf(Date);
      expect(res.deletedAt).toBeInstanceOf(Date);
      // non-PII aggregates conserved
      expect(res.loyaltyPoints).toBe(120);
      expect(res.visitCount).toBe(7);
      expect(customerRepo.save).toHaveBeenCalled();
    });

    it('is idempotent — a second call does not re-scrub / re-save', async () => {
      const already: any = { id: 'c1', firstName: '', anonymizedAt: new Date(), deletedAt: new Date() };
      customerRepo.findOne.mockResolvedValue(already);
      const res = await service.anonymize('c1');
      expect(res).toBe(already);
      expect(customerRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFound for an unknown customer', async () => {
      customerRepo.findOne.mockResolvedValue(null);
      await expect(service.anonymize('nope')).rejects.toThrow(NotFoundException);
    });
  });
});
