import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { mapStoreEntityToStoreInfo } from '../stores/store-info.mapper';

// Bcrypt cost factor 12 = ~250ms per hash on modern hardware
// Makes brute-force on 4-digit PINs impractical even with the rate limiter bypassed
const BCRYPT_SALT_ROUNDS = 12;

// Lockout after N failed attempts per store
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // In-memory lockout map (use Redis in V1 for multi-instance deployments)
  private readonly failedAttempts = new Map<
    string,
    { count: number; lockedUntil: Date | null }
  >();

  // In-memory token revocation set (use Redis in V1 for multi-instance deployments)
  // Tracks employeeIds whose tokens have been revoked via logout
  private readonly revokedTokens = new Set<string>();

  /**
   * Token family tracking — maps employeeId to their current valid refresh token family.
   * If a refresh token is reused (replay), the entire family is revoked.
   * Key: employeeId, Value: current valid jti
   */
  private readonly tokenFamilies = new Map<string, string>();

  constructor(
    @InjectRepository(EmployeeEntity)
    private employeeRepo: Repository<EmployeeEntity>,
    @InjectRepository(StoreEntity)
    private storeRepo: Repository<StoreEntity>,
    private jwtService: JwtService,
  ) {}

  async loginByPin(storeId: string, pin: string) {
    this.checkLockout(storeId);

    const employees = await this.employeeRepo.find({
      where: { storeId, isActive: true },
    });

    for (const emp of employees) {
      const match = await bcrypt.compare(pin, emp.pinHash);
      if (match) {
        this.clearFailedAttempts(storeId);
        // Clear any previous revocation on re-login
        this.revokedTokens.delete(emp.id);
        this.logger.log(
          `Login OK: ${emp.firstName} ${emp.lastName} (${emp.role}) store=${storeId}`,
        );
        return await this.generateTokens(emp);
      }
    }

    this.recordFailedAttempt(storeId);
    throw new UnauthorizedException('Invalid PIN');
  }

  /**
   * Super admin login: email + PIN, no storeId required.
   * Only works for 'admin' role employees.
   * Returns global access (storeId = employee's home store, but admin bypass grants all).
   */
  async loginByEmail(email: string, pin: string) {
    const employee = await this.employeeRepo.findOne({
      where: { email, isActive: true },
    });

    if (!employee) {
      throw new UnauthorizedException('Invalid email or PIN');
    }

    if (employee.role !== 'admin') {
      throw new UnauthorizedException('Admin login requires admin role');
    }

    this.checkLockout(employee.storeId);

    const match = await bcrypt.compare(pin, employee.pinHash);
    if (!match) {
      this.recordFailedAttempt(employee.storeId);
      throw new UnauthorizedException('Invalid email or PIN');
    }

    this.clearFailedAttempts(employee.storeId);
    this.revokedTokens.delete(employee.id);
    this.logger.log(
      `Admin Login OK: ${employee.firstName} ${employee.lastName} (email=${email})`,
    );
    return await this.generateTokens(employee);
  }

  async loginByQrCode(qrCode: string, pin: string) {
    const employee = await this.employeeRepo.findOne({
      where: { qrCode, isActive: true },
    });
    if (!employee) throw new UnauthorizedException('Invalid QR code');

    this.checkLockout(employee.storeId);

    const match = await bcrypt.compare(pin, employee.pinHash);
    if (!match) {
      this.recordFailedAttempt(employee.storeId);
      throw new UnauthorizedException('Invalid PIN');
    }

    this.clearFailedAttempts(employee.storeId);
    this.revokedTokens.delete(employee.id);
    this.logger.log(
      `QR Login OK: ${employee.firstName} ${employee.lastName} store=${employee.storeId}`,
    );
    return await this.generateTokens(employee);
  }

  async validateEmployee(id: string): Promise<EmployeeEntity | null> {
    // Check if token was revoked via logout
    if (this.revokedTokens.has(id)) return null;
    return this.employeeRepo.findOne({ where: { id, isActive: true } });
  }

  /** Hash a PIN. Exported for use by EmployeesService. */
  static async hashPin(pin: string): Promise<string> {
    return bcrypt.hash(pin, BCRYPT_SALT_ROUNDS);
  }

  // -----------------------------------------------------------------------
  // Refresh token — validate and issue new access + refresh tokens (rotation)
  // Implements token family tracking for replay detection.
  // -----------------------------------------------------------------------
  async refreshAccessToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET!,
      });

      // Check if token was revoked
      if (this.revokedTokens.has(payload.sub)) {
        throw new UnauthorizedException('Token has been revoked');
      }

      // Replay detection: check if the refresh token's jti matches the current family
      const currentJti = this.tokenFamilies.get(payload.sub);
      if (payload.jti && currentJti && payload.jti !== currentJti) {
        // Token reuse detected! Revoke the entire family (potential token theft)
        this.logger.error(
          `TOKEN REPLAY DETECTED for employee ${payload.sub}! ` +
          `Expected jti=${currentJti}, got jti=${payload.jti}. Revoking all tokens.`,
        );
        this.revokedTokens.add(payload.sub);
        this.tokenFamilies.delete(payload.sub);
        throw new UnauthorizedException('Token reuse detected. All sessions revoked.');
      }

      // Verify employee still exists and is active
      const employee = await this.employeeRepo.findOne({
        where: { id: payload.sub, isActive: true },
      });
      if (!employee) {
        throw new UnauthorizedException('Employee no longer active');
      }

      // Issue new tokens (rotation: old refresh token is implicitly replaced)
      this.logger.log(`Token refreshed for ${employee.firstName} ${employee.lastName}`);
      return await this.generateTokens(employee);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  // -----------------------------------------------------------------------
  // Logout — revoke tokens for employee
  // -----------------------------------------------------------------------
  logout(employeeId: string): void {
    this.revokedTokens.add(employeeId);
    this.logger.log(`Logout: tokens revoked for employee ${employeeId}`);

    // Auto-cleanup: remove from revoked set after refresh token max lifetime (7 days)
    setTimeout(() => {
      this.revokedTokens.delete(employeeId);
    }, 7 * 24 * 60 * 60 * 1000);
  }

  // -----------------------------------------------------------------------
  // Token generation + store info
  // -----------------------------------------------------------------------
  private async generateTokens(employee: EmployeeEntity) {
    // Generate unique token ID for replay protection
    const jti = randomBytes(16).toString('hex');

    const payload = {
      sub: employee.id,
      storeId: employee.storeId,
      role: employee.role,
    };

    // Fetch store to build storeInfo for the frontend
    const store = await this.storeRepo.findOne({
      where: { id: employee.storeId },
    });

    // Track the current valid refresh token family
    this.tokenFamilies.set(employee.id, jti);

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(
        { ...payload, jti },
        {
          secret: process.env.JWT_REFRESH_SECRET!,
          expiresIn: '7d',
        },
      ),
      employee: {
        id: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        role: employee.role,
        storeId: employee.storeId,
      },
      storeInfo: store ? mapStoreEntityToStoreInfo(store) : null,
    };
  }

  // -----------------------------------------------------------------------
  // Brute-force lockout
  // -----------------------------------------------------------------------
  private checkLockout(storeId: string): void {
    const record = this.failedAttempts.get(storeId);
    if (!record) return;

    if (record.lockedUntil && record.lockedUntil > new Date()) {
      const remaining = Math.ceil(
        (record.lockedUntil.getTime() - Date.now()) / 1000,
      );
      this.logger.warn(`Lockout active: store ${storeId}, ${remaining}s left`);
      throw new UnauthorizedException(
        `Too many failed attempts. Try again in ${remaining} seconds.`,
      );
    }

    // Lockout expired
    if (record.lockedUntil && record.lockedUntil <= new Date()) {
      this.failedAttempts.delete(storeId);
    }
  }

  private recordFailedAttempt(storeId: string): void {
    const record = this.failedAttempts.get(storeId) || {
      count: 0,
      lockedUntil: null,
    };
    record.count++;

    if (record.count >= MAX_FAILED_ATTEMPTS) {
      record.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      this.logger.warn(
        `Store ${storeId} LOCKED after ${record.count} failures until ${record.lockedUntil.toISOString()}`,
      );
    }

    this.failedAttempts.set(storeId, record);
  }

  private clearFailedAttempts(storeId: string): void {
    this.failedAttempts.delete(storeId);
  }
}
