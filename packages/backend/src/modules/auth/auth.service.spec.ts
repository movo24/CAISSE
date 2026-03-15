import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { StoreEntity } from '../../database/entities/store.entity';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let employeeRepo: any;
  let storeRepo: any;

  const mockStore: Partial<StoreEntity> = {
    id: 'store-1',
    name: 'Test Store',
    city: 'Paris',
    currencyCode: 'EUR',
  };

  const mockEmployee: Partial<EmployeeEntity> = {
    id: 'emp-1',
    storeId: 'store-1',
    firstName: 'Jean',
    lastName: 'Dupont',
    role: 'cashier',
    isActive: true,
    pinHash: '', // will be set in beforeEach
  };

  beforeEach(async () => {
    // Hash a known PIN
    const pinHash = await bcrypt.hash('1234', 10);
    mockEmployee.pinHash = pinHash;

    employeeRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
    };

    storeRepo = {
      findOne: jest.fn().mockResolvedValue(mockStore),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-jwt-token'),
            verify: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(EmployeeEntity),
          useValue: employeeRepo,
        },
        {
          provide: getRepositoryToken(StoreEntity),
          useValue: storeRepo,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  // ─────────────────────────────────────────────────────────────
  // loginByPin
  // ─────────────────────────────────────────────────────────────

  describe('loginByPin', () => {
    it('should return tokens on valid PIN', async () => {
      employeeRepo.find.mockResolvedValue([mockEmployee]);

      const result = await service.loginByPin('store-1', '1234');

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.refreshToken).toBe('mock-jwt-token');
      expect(result.employee.id).toBe('emp-1');
      expect(result.employee.role).toBe('cashier');
    });

    it('should throw UnauthorizedException on invalid PIN', async () => {
      employeeRepo.find.mockResolvedValue([mockEmployee]);

      await expect(service.loginByPin('store-1', '9999')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when no employees found', async () => {
      employeeRepo.find.mockResolvedValue([]);

      await expect(service.loginByPin('store-1', '1234')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should lock out after 5 failed attempts', async () => {
      employeeRepo.find.mockResolvedValue([mockEmployee]);

      // Fail 5 times
      for (let i = 0; i < 5; i++) {
        await expect(service.loginByPin('store-lockout', '0000')).rejects.toThrow(
          UnauthorizedException,
        );
      }

      // 6th attempt should be locked out even with correct PIN
      await expect(service.loginByPin('store-lockout', '1234')).rejects.toThrow(
        /Too many failed attempts/,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // loginByQrCode
  // ─────────────────────────────────────────────────────────────

  describe('loginByQrCode', () => {
    it('should return tokens on valid QR + PIN', async () => {
      employeeRepo.findOne.mockResolvedValue(mockEmployee);

      const result = await service.loginByQrCode('QR-001', '1234');

      expect(result.accessToken).toBeDefined();
      expect(result.employee.firstName).toBe('Jean');
    });

    it('should throw on invalid QR code', async () => {
      employeeRepo.findOne.mockResolvedValue(null);

      await expect(service.loginByQrCode('BAD-QR', '1234')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw on valid QR but wrong PIN', async () => {
      employeeRepo.findOne.mockResolvedValue(mockEmployee);

      await expect(service.loginByQrCode('QR-001', '0000')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // refreshAccessToken
  // ─────────────────────────────────────────────────────────────

  describe('refreshAccessToken', () => {
    it('should issue new tokens on valid refresh token', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: 'emp-1',
        storeId: 'store-1',
        role: 'cashier',
      });
      employeeRepo.findOne.mockResolvedValue(mockEmployee);

      const result = await service.refreshAccessToken('valid-refresh-token');

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should reject revoked tokens', async () => {
      service.logout('emp-1');
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: 'emp-1',
        storeId: 'store-1',
      });

      await expect(
        service.refreshAccessToken('revoked-refresh-token'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject when employee is inactive', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: 'emp-inactive',
        storeId: 'store-1',
      });
      employeeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.refreshAccessToken('inactive-refresh-token'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // validateEmployee
  // ─────────────────────────────────────────────────────────────

  describe('validateEmployee', () => {
    it('should return employee when active and not revoked', async () => {
      employeeRepo.findOne.mockResolvedValue(mockEmployee);

      const result = await service.validateEmployee('emp-1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('emp-1');
    });

    it('should return null for revoked tokens', async () => {
      service.logout('emp-1');

      const result = await service.validateEmployee('emp-1');
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // logout
  // ─────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('should revoke tokens and reject subsequent validation', async () => {
      service.logout('emp-1');

      const result = await service.validateEmployee('emp-1');
      expect(result).toBeNull();
    });

    it('should allow re-login after logout', async () => {
      service.logout('emp-1');
      employeeRepo.find.mockResolvedValue([mockEmployee]);

      const result = await service.loginByPin('store-1', '1234');
      expect(result.accessToken).toBeDefined();

      // After re-login, token should not be revoked
      employeeRepo.findOne.mockResolvedValue(mockEmployee);
      const validated = await service.validateEmployee('emp-1');
      expect(validated).toBeDefined();
    });
  });
});
