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
import * as bcrypt from 'bcrypt';
import { StoreEntity } from '../../database/entities/store.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { mapStoreEntityToStoreInfo } from '../stores/store-info.mapper';
import { TimewinService } from '../timewin/timewin.service';
import { logBusinessEvent } from '../../common/business-logger';
import { CACHE_STORE } from '../../common/cache/cache.module';
import { ICacheStore } from '../../common/cache/cache-store';
import { AuditService } from '../audit/audit.service';

/** Conventional store id for global (store-less) audit events like admin login. */
const ADMIN_AUDIT_STORE = '_admin';

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
    @InjectRepository(EmployeeEntity)
    private employeeRepo: Repository<EmployeeEntity>,
    private jwtService: JwtService,
    private timewin: TimewinService,
    @Inject(CACHE_STORE) private cache: ICacheStore,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Audit a successful admin login. Append-only hash chain, store-less events
   * use the conventional ADMIN_AUDIT_STORE. Never blocks login, never logs the PIN.
   */
  private async auditAdminLogin(result: any, email: string, via: string): Promise<void> {
    try {
      const empId = result?.employee?.id;
      if (!empId) return;
      await this.auditService.log({
        storeId: result?.employee?.storeId || ADMIN_AUDIT_STORE,
        employeeId: empId,
        action: 'admin_login',
        entityType: 'auth',
        entityId: empId,
        details: {
          email,
          role: result?.employee?.role,
          via,
        },
      });
    } catch {
      /* audit failure must never break authentication */
    }
  }

  /**
   * Audit a FAILED admin login attempt (brute-force / unauthorized-access
   * signal). Written to the global ADMIN_AUDIT_STORE chain so it can be
   * reviewed via GET /audit?storeId=_admin. No employee is authenticated, so
   * employeeId is 'unknown'; the PIN is NEVER logged — only the attempted
   * email and a coarse failure reason.
   */
  private async auditAdminLoginFailed(email: string, err: any): Promise<void> {
    try {
      await this.auditService.log({
        storeId: ADMIN_AUDIT_STORE,
        employeeId: 'unknown',
        action: 'admin_login_failed',
        entityType: 'auth',
        entityId: email || 'unknown',
        details: {
          email: email || null,
          reason: err?.name || 'error',
          source: 'admin_email_login',
        },
      });
    } catch {
      /* audit failure must never affect the auth error returned to the client */
    }
  }

  /**
   * Login by PIN.
   *
   * AUTHORITY: POS Caisse is the PRIMARY source of truth for cashier codes
   * (product decision). The local employees table is checked FIRST; TimeWin24
   * is only consulted as a secondary fallback when the local check finds no
   * matching account AND TimeWin authority is still enabled.
   *
   * Set POS_AUTH_AUTHORITY=timewin to restore the legacy TimeWin24-first flow.
   */
  async loginByPin(storeIdOrCode: string, pin: string) {
    // Resolve storeCode to storeId if not a UUID
    let storeId = storeIdOrCode;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeIdOrCode);
    if (!isUUID) {
      const store = await this.storeRepo.findOne({ where: { storeCode: storeIdOrCode.toUpperCase() } });
      if (!store) {
        throw new UnauthorizedException(`Magasin introuvable: ${storeIdOrCode}`);
      }
      storeId = store.id;
      this.logger.log(`[AUTH] Resolved storeCode "${storeIdOrCode}" → storeId "${storeId}"`);
    }

    // Legacy mode: TimeWin24 is the authority (opt-in via env).
    if (this.timewinIsAuthority()) {
      try {
        const twResult = await this.timewin.loginEmployee({ pin, storeId });
        return await this.buildSessionFromTimewin(twResult, storeId);
      } catch (err: any) {
        this.logger.warn(`[AUTH] TimeWin24 error (${err.message}), falling back to local DB`);
        return this.authenticateLocal(storeId, { pin });
      }
    }

    // Default: POS Caisse is the authority — check local DB FIRST.
    try {
      return await this.authenticateLocal(storeId, { pin });
    } catch (err: any) {
      // Only consult TimeWin24 when the local account was simply NOT FOUND
      // (transitional support for staff still living only in TimeWin24).
      // A wrong PIN on an existing local account is a hard failure — never
      // masked by a TimeWin lookup.
      if (this.timewinFallbackEnabled() && this.isAccountNotFound(err)) {
        this.logger.log('[AUTH] Local account not found — trying TimeWin24 as secondary');
        try {
          const twResult = await this.timewin.loginEmployee({ pin, storeId });
          return await this.buildSessionFromTimewin(twResult, storeId);
        } catch (twErr: any) {
          this.logger.warn(`[AUTH] TimeWin24 secondary failed (${twErr.message})`);
          throw err; // surface the original local error
        }
      }
      throw err;
    }
  }

  /**
   * Admin login by email. POS Caisse is the authority: the local employees
   * table is checked FIRST. TimeWin24 is only a secondary fallback for an
   * email not present locally (and only in legacy/transitional mode).
   */
  async loginByEmail(email: string, pin: string) {
    let resolved;
    try {
      resolved = await this.resolveAdminLogin(email, pin);
    } catch (err: any) {
      // Audit the FAILED attempt (non-blocking), then surface the original error.
      await this.auditAdminLoginFailed(email, err);
      throw err;
    }
    // Audit the successful admin access (non-blocking, PIN never logged).
    await this.auditAdminLogin(resolved.result, email, resolved.via);
    return resolved.result;
  }

  /** Resolve admin login through the authority chain; returns the session + source. */
  private async resolveAdminLogin(
    email: string,
    pin: string,
  ): Promise<{ result: any; via: string }> {
    if (this.timewinIsAuthority()) {
      try {
        const twResult = await this.timewin.loginEmployee({
          pin,
          employeeCode: email,
          storeId: '_admin',
        });
        return { result: await this.buildSessionFromTimewin(twResult, twResult.store_id), via: 'timewin24' };
      } catch (err: any) {
        this.logger.warn(`[AUTH] TimeWin24 error (${err.message}), falling back to local DB`);
        return { result: await this.authenticateLocal('_admin', { pin, email }), via: 'caisse_local' };
      }
    }

    try {
      return { result: await this.authenticateLocal('_admin', { pin, email }), via: 'caisse_local' };
    } catch (err: any) {
      if (this.timewinFallbackEnabled() && this.isAccountNotFound(err)) {
        this.logger.log('[AUTH] Local admin not found — trying TimeWin24 as secondary');
        try {
          const twResult = await this.timewin.loginEmployee({
            pin,
            employeeCode: email,
            storeId: '_admin',
          });
          return { result: await this.buildSessionFromTimewin(twResult, twResult.store_id), via: 'timewin24_secondary' };
        } catch (twErr: any) {
          this.logger.warn(`[AUTH] TimeWin24 secondary failed (${twErr.message})`);
          throw err;
        }
      }
      throw err;
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

  /* ── Authority configuration ── */

  /** Legacy mode: TimeWin24 authenticates first. Opt-in via env. */
  private timewinIsAuthority(): boolean {
    return (process.env.POS_AUTH_AUTHORITY || 'caisse').toLowerCase() === 'timewin';
  }

  /**
   * Whether TimeWin24 may still be consulted as a SECONDARY source when a
   * local account is not found. Default true (transitional). Set
   * POS_AUTH_TIMEWIN_FALLBACK=false to make POS Caisse the sole authority.
   */
  private timewinFallbackEnabled(): boolean {
    return (process.env.POS_AUTH_TIMEWIN_FALLBACK || 'true').toLowerCase() !== 'false';
  }

  /** Distinguish "no such account" (safe to try TimeWin) from "wrong PIN". */
  private isAccountNotFound(err: any): boolean {
    return err instanceof UnauthorizedException && (err as any).accountNotFound === true;
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
    logBusinessEvent({
      event: 'EMPLOYEE_LOGIN',
      storeId: tw.store_id || storeId,
      employeeId: tw.employee_id,
      data: { name: tw.full_name, role: tw.role, via: 'timewin24' },
    });

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
   * Authenticate against the local POS Caisse employees table — the PRIMARY
   * authority for cashier/admin codes.
   *
   * Throws UnauthorizedException. "Account not found" errors are tagged with
   * `accountNotFound = true` so the caller may optionally try TimeWin24 as a
   * secondary source; a WRONG PIN is never tagged and is a hard failure.
   */
  private async authenticateLocal(storeId: string, opts: { pin?: string; email?: string }) {
    this.logger.log(`[AUTH] Authenticating against local POS Caisse DB (primary authority)`);

    let employees: EmployeeEntity[];

    if (opts.email) {
      // Admin login by email — search across all stores
      employees = await this.employeeRepo.find({
        where: { email: opts.email, isActive: true },
      });
    } else {
      // PIN login — search employees authorized for this store
      // Checks both primary storeId AND multi-store access table
      try {
        employees = await this.employeeRepo
          .createQueryBuilder('e')
          .where('e.isActive = true')
          .andWhere(
            '(e.storeId = :storeId OR e.id IN (SELECT employee_id FROM employee_store_access WHERE store_id = :storeId))',
            { storeId },
          )
          .getMany();
      } catch (err: any) {
        // If employee_store_access doesn't exist yet (migration pending), fallback gracefully
        if (err?.message?.includes('employee_store_access') || err?.message?.includes('does not exist')) {
          this.logger.warn('[AUTH] employee_store_access table missing — using simple store match');
          employees = await this.employeeRepo.find({ where: { storeId, isActive: true } });
        } else {
          throw err; // Re-throw real errors — don't mask them
        }
      }
    }

    if (!employees.length) {
      const notFound = new UnauthorizedException(
        opts.email
          ? 'Email administrateur introuvable. Vérifiez l\'adresse email.'
          : 'Aucun employé trouvé pour ce magasin. Vérifiez le code magasin.',
      );
      (notFound as any).accountNotFound = true; // safe to try TimeWin24 secondary
      throw notFound;
    }

    // Check PIN against each employee's bcrypt hash
    for (const emp of employees) {
      if (opts.pin && await bcrypt.compare(opts.pin, emp.pinHash)) {
        // Match found — build session locally
        const jti = randomBytes(16).toString('hex');
        await this.cache.set(`token_family:${emp.id}`, jti, TOKEN_REVOKE_TTL);
        await this.cache.srem('revoked_tokens', emp.id);

        const payload = {
          sub: emp.id,
          storeId: emp.storeId,
          role: emp.role,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          maxDiscount: emp.maxDiscountPercent,
        };

        const store = await this.storeRepo.findOne({ where: { id: emp.storeId } }).catch(() => null);

        this.logger.log(`[AUTH] Login OK (POS Caisse local): ${emp.firstName} ${emp.lastName} (${emp.role}) store=${emp.storeId}`);

        return {
          accessToken: this.jwtService.sign(payload),
          refreshToken: this.jwtService.sign(
            { ...payload, jti },
            { secret: process.env.JWT_REFRESH_SECRET!, expiresIn: '7d' },
          ),
          employee: {
            id: emp.id,
            employeeCode: emp.qrCode,
            firstName: emp.firstName,
            lastName: emp.lastName,
            email: emp.email,
            role: emp.role,
            storeId: emp.storeId,
            maxDiscountPercent: emp.maxDiscountPercent,
          },
          storeInfo: store ? mapStoreEntityToStoreInfo(store) : null,
        };
      }
    }

    throw new UnauthorizedException('Code PIN incorrect');
  }
}
