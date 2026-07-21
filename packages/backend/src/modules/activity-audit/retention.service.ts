import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Not, Repository } from 'typeorm';
import { UserLoginEventEntity } from '../../database/entities/user-login-event.entity';
import { UserViewEventEntity } from '../../database/entities/user-view-event.entity';
import { UserSessionEntity } from '../../database/entities/user-session.entity';
import { loadRetentionConfig, RetentionConfig } from './retention.config';

export interface PurgeResult {
  loginEvents: number;
  viewEvents: number;
  accessDenied: number;
  sessions: number;
  geoScrubbed: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Purge/agrégation de la télémétrie selon la politique de rétention (spec §16).
 * NON destructif pour access_audit_log (immuable). Purge OPT-IN (désactivée par défaut).
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @InjectRepository(UserLoginEventEntity) private readonly loginRepo: Repository<UserLoginEventEntity>,
    @InjectRepository(UserViewEventEntity) private readonly viewRepo: Repository<UserViewEventEntity>,
    @InjectRepository(UserSessionEntity) private readonly sessionRepo: Repository<UserSessionEntity>,
  ) {}

  /** Cron quotidien — n'exécute la purge QUE si explicitement activée. */
  @Cron('0 3 * * *', { name: 'activity-retention-purge', timeZone: 'Europe/Paris' })
  async scheduledPurge(): Promise<void> {
    const cfg = loadRetentionConfig();
    if (!cfg.enabled) return; // opt-in : rien sans RETENTION_PURGE_ENABLED=true
    const res = await this.purgeExpired(new Date(), cfg);
    this.logger.log(`[RETENTION] purge: ${JSON.stringify(res)}`);
  }

  /**
   * Supprime les lignes expirées et efface la géo au-delà de sa durée. `access_audit_log`
   * n'est JAMAIS touché. Retourne le décompte par catégorie.
   */
  async purgeExpired(now: Date = new Date(), cfg: RetentionConfig = loadRetentionConfig()): Promise<PurgeResult> {
    const cutoff = (days: number) => new Date(now.getTime() - days * DAY_MS);

    const login = await this.loginRepo.delete({ occurredAt: LessThan(cutoff(cfg.loginEventDays)) });
    const views = await this.viewRepo.delete({
      action: Not('ACCESS_DENIED'),
      occurredAt: LessThan(cutoff(cfg.viewEventDays)),
    });
    const denied = await this.viewRepo.delete({
      action: 'ACCESS_DENIED',
      occurredAt: LessThan(cutoff(cfg.accessDeniedDays)),
    });
    const sessions = await this.sessionRepo.delete({
      startedAt: LessThan(cutoff(cfg.sessionDays)),
    });

    // Géo : au-delà de geoDays, on efface les champs de localisation mais on CONSERVE la ligne.
    const geoCutoff = cutoff(cfg.geoDays);
    const stale = await this.loginRepo
      .createQueryBuilder('e')
      .where('e.occurredAt < :c', { c: geoCutoff })
      .andWhere('(e.countryCode IS NOT NULL OR e.region IS NOT NULL OR e.city IS NOT NULL)')
      .getMany();
    for (const r of stale) {
      r.countryCode = null;
      r.region = null;
      r.city = null;
      r.approximateLatitude = null;
      r.approximateLongitude = null;
    }
    if (stale.length) await this.loginRepo.save(stale);

    return {
      loginEvents: login.affected ?? 0,
      viewEvents: views.affected ?? 0,
      accessDenied: denied.affected ?? 0,
      sessions: sessions.affected ?? 0,
      geoScrubbed: stale.length,
    };
  }
}
