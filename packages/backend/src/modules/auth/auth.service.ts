import {
  Injectable,
  UnauthorizedException,
  Logger,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { StoreEntity } from '../../database/entities/store.entity';
import { mapStoreEntityToStoreInfo } from '../stores/store-info.mapper';
import { TimewinService } from '../timewin/timewin.service';
import { CACHE_STORE } from '../../common/cache/cache.module';
import { ICacheStore } from '../../common/cache/cache-store';

const TOKEN_REVOKE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Auth service — delegates employee authentication to TimeWin24.
 *
 * Token revocation is now persisted via ICacheStore (Redis in production).
 * This means:
 *   - Revocations survive server restarts
 *   - Consistent across multiple POS instances
 *   - Auto-expire after 7 days (JWT max lifetime)
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(StoreEntity)
    private storeRepo: Repository<StoreEntity>,
    private jwtService: JwtService,
    private timewin: TimewinService,
    @Inject(CACHE_STORE) private cache: ICacheStore,
  ) {}

  /**
   * Login by PIN — primary flow via TimeWin24
   */
  async loginByPin(storeId: string, pin: string) {
    try {
      const twResult = await this.timewin.loginEmployee({ pin, storeId });
      return await this.buildSessionFromTimewin(twResult, storeId);
    } catch (err: any) {
      if (err.status === undefined || err.status >= 500) {
        this.logger.warn(`TimeWin24 unreachable for PIN login, attempting offline cache`);
        return this.offlineFallback(storeId, { pin });
      }
      throw new UnauthorizedException(
        err.response?.error || 'Invalid PIN',
      );
    }
  }

  /**
   * Admin login by email — via TimeWin24
   */
  async loginByEmail(email: string, pin: string) {
    try {
      const twResult = await this.timewin.loginEmployee({
        pin,
        employeeCode: email,
        storeId: '_admin',
      });
      return await this.buildSessionFromTimewin(twResult, twResult.store_id);
    } catch (err: any) {
      throw new UnauthorizedException(
        err.response?.error || 'Invalid email or PIN',
      );
    }
  }

  /**
   * Login by QR code — via TimeWin24
   */
  async loginByQrCode(qrCode: string, pin: string) {
    try {
      const twResult = await this.timewin.loginEmployee({ qrCode, pin, storeId: '_any' });
      return await this.buildSessionFromTimewin(twResult, twResult.store_id);
    } catch (err: any) {
      if (err.status === undefined || err.status >= 500) {
        this.logger.warn(`TimeWin24 unreachable for QR login`);
        throw new UnauthorizedException('TimeWin24 unreachable — QR login requires online connection');
      }
      throw new UnauthorizedException(
        err.response?.error || 'Invalid QR code',
      );
    }
  }

  /**
   * Validate an employee by ID (for JWT strategy).
   * Checks revocation in persistent cache.
   */
  async validateEmployee(id: string): Promise<any | null> {
    const isRevoked = await this.cache.sismember('revoked_tokens', id);
    if (isRevoked) return null;
    return { id, isActive: true };
  }

  /**
   * Refresh access token — with replay detection via persistent cache
   */
  async refreshAccessToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET!,
      });

      // Check revocation
      const isRevoked = await this.cache.sismember('revoked_tokens', payload.sub);
      if (isRevoked) {
        throw new UnauthorizedException('Token has been revoked');
      }

      // Replay detection — compare JTI with stored family
      const currentJti = await this.cache.get<string>(`token_family:${payload.sub}`);
      if (payload.jti && currentJti && payload.jti !== currentJti) {
        this.logger.error(`TOKEN REPLAY DETECTED for ${payload.sub}`);
        // Revoke entire family
        await this.cache.sadd('revoked_tokens', payload.sub, TOKEN_REVOKE_TTL);
        await this.cache.del(`token_family:${payload.sub}`);
        throw new UnauthorizedException('Token reuse detected');
      }

      // Re-issue tokens with new JTI
      const jti = randomBytes(16).toString('hex');
      await this.cache.set(`token_family:${payload.sub}`, jti, TOKEN_REVOKE_TTL);

      return {
        accessToken: this.jwtService.sign({
          sub: payload.sub,
          storeId: payload.storeId,
          role: payload.role,
          employeeName: payload.employeeName,
          maxDiscount: payload.maxDiscount,
        }),
        refreshToken: this.jwtService.sign(
          { sub: payload.sub, storeId: payload.storeId, role: payload.role, jti },
          { secret: process.env.JWT_REFRESH_SECRET!, expiresIn: '7d' },
        ),
        employee: {
          id: payload.sub,
          storeId: payload.storeId,
          role: payload.role,
        },
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  /**
   * Logout — revoke tokens (persisted in Redis, survives restart)
   */
  async logout(employeeId: string): Promise<void> {
    await this.cache.sadd('revoked_tokens', employeeId, TOKEN_REVOKE_TTL);
    await this.cache.del(`token_family:${employeeId}`);
    this.logger.log(`Logout: tokens revoked for ${employeeId}`);
  }

  /* ── Private helpers ── */

  private async buildSessionFromTimewin(tw: any, storeId: string) {
    const jti = randomBytes(16).toString('hex');
    await this.cache.set(`token_family:${tw.employee_id}`, jti, TOKEN_REVOKE_TTL);
    // Clear any previous revocation on fresh login
    await this.cache.srem('revoked_tokens', tw.employee_id);

    const payload = {
      sub: tw.employee_id,
      storeId: tw.store_id || storeId,
      role: tw.role,
      employeeName: tw.full_name,
      maxDiscount: tw.max_discount,
    };

    const store = await this.storeRepo.findOne({ where: { id: storeId } }).catch(() => null);

    this.logger.log(`Login OK via TimeWin24: ${tw.full_name} (${tw.role}) store=${storeId}`);

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(
        { ...payload, jti },
        { secret: process.env.JWT_REFRESH_SECRET!, expiresIn: '7d' },
      ),
      employee: {
        id: tw.employee_id,
        employeeCode: tw.employee_code,
        firstName: tw.full_name.split(' ')[0],
        lastName: tw.full_name.split(' ').slice(1).join(' '),
        role: tw.role,
        storeId: tw.store_id || storeId,
        maxDiscountPercent: tw.max_discount,
      },
      permissions: tw.permissions,
      storeInfo: store ? mapStoreEntityToStoreInfo(store) : null,
      snapshot: tw.snapshot,
    };
  }

  /**
   * Offline fallback — disabled for security (PINs not cached in plaintext)
   */
  private async offlineFallback(storeId: string, _opts: { pin?: string }): Promise<never> {
    throw new UnauthorizedException(
      'TimeWin24 unreachable — new logins require online connection. Use existing session if available.',
    );
  }
}
