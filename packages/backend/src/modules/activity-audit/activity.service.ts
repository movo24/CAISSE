import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { UserLoginEventEntity } from '../../database/entities/user-login-event.entity';
import { UserSessionEntity } from '../../database/entities/user-session.entity';
import { AuthMethod, LoginEventType, hashIp, sanitizeFailureReason } from './activity.constants';

export interface DeviceContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceType?: string | null;
  operatingSystem?: string | null;
  browser?: string | null;
  applicationVersion?: string | null;
}

export interface RecordLoginParams extends DeviceContext {
  employeeId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  eventType: LoginEventType;
  success: boolean;
  authenticationMethod?: AuthMethod | null;
  failureReason?: unknown;
  isNewDevice?: boolean;
  riskScore?: number;
}

/**
 * Télémétrie de connexion & sessions. TOUTES les écritures sont NON BLOQUANTES :
 * une panne de journalisation ne doit JAMAIS empêcher un login ou une navigation (spec §17).
 * Aucun secret n'est stocké (pas de PIN/mot de passe/token).
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    @InjectRepository(UserLoginEventEntity)
    private readonly loginRepo: Repository<UserLoginEventEntity>,
    @InjectRepository(UserSessionEntity)
    private readonly sessionRepo: Repository<UserSessionEntity>,
  ) {}

  // ─────────────────────────── WRITE (non-throwing) ───────────────────────────

  /** Ouvre une session d'auth. Retourne son id, ou null si l'écriture échoue (non bloquant). */
  async startSession(p: DeviceContext & { employeeId?: string | null; userId?: string | null }): Promise<string | null> {
    try {
      const s = await this.sessionRepo.save(
        this.sessionRepo.create({
          employeeId: p.employeeId ?? null,
          userId: p.userId ?? null,
          startedAt: new Date(),
          lastActivityAt: new Date(),
          ipAddress: p.ipAddress ?? null,
          deviceType: p.deviceType ?? null,
          operatingSystem: p.operatingSystem ?? null,
          browser: p.browser ?? null,
          applicationVersion: p.applicationVersion ?? null,
        }),
      );
      return s.id;
    } catch (e) {
      this.logger.warn(`[ACTIVITY] startSession failed (non-blocking): ${(e as Error)?.message}`);
      return null;
    }
  }

  /** Journalise un événement de connexion. Ne lève jamais. */
  async recordLogin(p: RecordLoginParams): Promise<void> {
    try {
      await this.loginRepo.save(
        this.loginRepo.create({
          employeeId: p.employeeId ?? null,
          userId: p.userId ?? null,
          sessionId: p.sessionId ?? null,
          eventType: p.eventType,
          success: p.success,
          failureReason: p.failureReason != null ? sanitizeFailureReason(p.failureReason) : null,
          authenticationMethod: p.authenticationMethod ?? null,
          ipAddress: p.ipAddress ?? null,
          ipHash: p.ipAddress ? hashIp(p.ipAddress) : null,
          userAgent: p.userAgent ?? null,
          deviceType: p.deviceType ?? null,
          operatingSystem: p.operatingSystem ?? null,
          browser: p.browser ?? null,
          applicationVersion: p.applicationVersion ?? null,
          isNewDevice: p.isNewDevice ?? false,
          riskScore: p.riskScore ?? 0,
        }),
      );
    } catch (e) {
      this.logger.warn(`[ACTIVITY] recordLogin failed (non-blocking): ${(e as Error)?.message}`);
    }
  }

  async endSession(sessionId: string | null | undefined, reason: string): Promise<void> {
    if (!sessionId) return;
    try {
      await this.sessionRepo.update({ id: sessionId, endedAt: IsNull() }, { endedAt: new Date(), endReason: reason });
    } catch (e) {
      this.logger.warn(`[ACTIVITY] endSession failed (non-blocking): ${(e as Error)?.message}`);
    }
  }

  /** Ferme toutes les sessions actives d'un employé (déconnexion globale). Retourne le nb fermé. */
  async endActiveSessionsForEmployee(employeeId: string, reason: string): Promise<number> {
    try {
      const active = await this.sessionRepo.find({ where: { employeeId, endedAt: IsNull() } });
      for (const s of active) {
        s.endedAt = new Date();
        s.endReason = reason;
      }
      if (active.length) await this.sessionRepo.save(active);
      return active.length;
    } catch (e) {
      this.logger.warn(`[ACTIVITY] endActiveSessions failed (non-blocking): ${(e as Error)?.message}`);
      return 0;
    }
  }

  /** Révoque une session (action de sécurité — lève si absente pour signaler l'échec admin). */
  async revokeSession(sessionId: string, revokedBy: string, reason: string): Promise<{ employeeId: string | null }> {
    const s = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('Session introuvable.');
    await this.sessionRepo.update(sessionId, {
      revokedAt: new Date(),
      revokedBy,
      revokeReason: reason,
      endedAt: s.endedAt ?? new Date(),
      endReason: s.endReason ?? 'revoked',
    });
    return { employeeId: s.employeeId };
  }

  async revokeAllSessionsForEmployee(employeeId: string, revokedBy: string, reason: string): Promise<number> {
    // Ne révoque que les sessions ENCORE ACTIVES (ni terminées, ni déjà révoquées).
    const active = await this.sessionRepo.find({ where: { employeeId, revokedAt: IsNull(), endedAt: IsNull() } });
    const now = new Date();
    for (const s of active) {
      s.revokedAt = now;
      s.revokedBy = revokedBy;
      s.revokeReason = reason;
      s.endedAt = s.endedAt ?? now;
      s.endReason = s.endReason ?? 'revoked';
    }
    if (active.length) await this.sessionRepo.save(active);
    return active.length;
  }

  /** Un appareil est « nouveau » si aucun login réussi antérieur pour cet employé avec ce user-agent. */
  async isNewDevice(employeeId: string | null | undefined, userAgent: string | null | undefined): Promise<boolean> {
    if (!employeeId || !userAgent) return false;
    try {
      const prior = await this.loginRepo.count({ where: { employeeId, userAgent, success: true } });
      return prior === 0;
    } catch {
      return false;
    }
  }

  // ─────────────────────────── QUERY (admin) ───────────────────────────

  async listLoginEvents(
    filters: { employeeId?: string; success?: boolean; method?: string; from?: Date; to?: Date } = {},
    page = 1,
    limit = 50,
  ): Promise<{ data: UserLoginEventEntity[]; total: number; page: number; limit: number }> {
    const qb = this.loginRepo.createQueryBuilder('e');
    if (filters.employeeId) qb.andWhere('e.employeeId = :eid', { eid: filters.employeeId });
    if (filters.success !== undefined) qb.andWhere('e.success = :s', { s: filters.success });
    if (filters.method) qb.andWhere('e.authenticationMethod = :m', { m: filters.method });
    if (filters.from) qb.andWhere('e.occurredAt >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('e.occurredAt <= :to', { to: filters.to });
    qb.orderBy('e.occurredAt', 'DESC').skip((page - 1) * limit).take(limit);
    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  async listSessions(
    filters: { employeeId?: string; activeOnly?: boolean } = {},
  ): Promise<UserSessionEntity[]> {
    const qb = this.sessionRepo.createQueryBuilder('s');
    if (filters.employeeId) qb.andWhere('s.employeeId = :eid', { eid: filters.employeeId });
    if (filters.activeOnly) qb.andWhere('s.endedAt IS NULL AND s.revokedAt IS NULL');
    return qb.orderBy('s.startedAt', 'DESC').getMany();
  }

  async sessionStats(employeeId: string, now: Date = new Date()): Promise<{
    totalLogins: number;
    last7d: number;
    last30d: number;
    failedCount: number;
    lastLoginAt: Date | null;
    activeSessions: number;
    distinctDevices: number;
  }> {
    const d7 = new Date(now.getTime() - 7 * 864e5);
    const d30 = new Date(now.getTime() - 30 * 864e5);
    const succWhere = { employeeId, success: true } as const;
    const [totalLogins, failedCount, activeSessions] = await Promise.all([
      this.loginRepo.count({ where: succWhere }),
      this.loginRepo.count({ where: { employeeId, success: false } }),
      this.sessionRepo.count({ where: { employeeId, endedAt: IsNull(), revokedAt: IsNull() } }),
    ]);
    const events = await this.loginRepo.find({ where: succWhere, order: { occurredAt: 'DESC' } });
    const last7d = events.filter((e) => e.occurredAt >= d7).length;
    const last30d = events.filter((e) => e.occurredAt >= d30).length;
    const distinctDevices = new Set(events.map((e) => e.userAgent).filter(Boolean)).size;
    return {
      totalLogins,
      last7d,
      last30d,
      failedCount,
      lastLoginAt: events[0]?.occurredAt ?? null,
      activeSessions,
      distinctDevices,
    };
  }
}
