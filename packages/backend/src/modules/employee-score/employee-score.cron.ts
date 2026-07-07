import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { EmployeeScoreService, parisDateStr } from './employee-score.service';

/**
 * Maintenance nocturne du score employé :
 *  1. balaye les sessions actives anormalement longues (jamais fermées) →
 *     SESSION_ABANDONED sur l'employé responsable + fermeture forcée ;
 *  2. recalcule les agrégats journaliers de la veille et du jour.
 *
 * Le fait objectif est « session non fermée / abandonnée » — on n'infère jamais
 * « il a laissé quelqu'un utiliser sa caisse ».
 */
@Injectable()
export class EmployeeScoreCron {
  private readonly logger = new Logger(EmployeeScoreCron.name);

  constructor(
    private readonly scoreService: EmployeeScoreService,
    @InjectRepository(PosSessionEntity)
    private readonly sessionRepo: Repository<PosSessionEntity>,
  ) {}

  /** Durée max d'une session avant d'être considérée abandonnée (heures). */
  private maxSessionHours(): number {
    return parseInt(process.env.SESSION_ABANDON_HOURS || '16', 10);
  }

  @Cron('0 3 * * *', { name: 'employee-score-nightly', timeZone: 'Europe/Paris' })
  async nightly(now: Date = new Date()): Promise<void> {
    try {
      await this.sweepAbandonedSessions(now);
    } catch (err) {
      this.logger.error(`sweepAbandonedSessions failed: ${err}`);
    }
    try {
      const today = parisDateStr(now);
      const yesterday = parisDateStr(new Date(now.getTime() - 24 * 3600 * 1000));
      const y = await this.scoreService.recomputeAllForDate(yesterday, now);
      const t = await this.scoreService.recomputeAllForDate(today, now);
      this.logger.log(`Nightly score recompute: ${y} employees (${yesterday}), ${t} (${today})`);
    } catch (err) {
      this.logger.error(`recompute failed: ${err}`);
    }
  }

  /**
   * Ferme les sessions actives ouvertes il y a plus de N heures et journalise un
   * SESSION_ABANDONED sur l'employé responsable. Exposé pour les tests.
   */
  async sweepAbandonedSessions(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.maxSessionHours() * 3600 * 1000);
    const stale = await this.sessionRepo.find({
      where: { isActive: true, openedAt: LessThan(cutoff) },
    });
    for (const s of stale) {
      await this.scoreService.logEvent({
        employeeId: s.employeeId,
        storeId: s.storeId,
        eventType: 'SESSION_ABANDONED',
        terminalId: s.terminalId,
        sessionId: s.id,
        reason: `Session ouverte depuis ${s.openedAt.toISOString()} jamais fermée (balayage automatique)`,
        createdBy: 'system',
        source: 'system',
      });
      s.isActive = false;
      s.closedAt = now;
      await this.sessionRepo.save(s);
    }
    if (stale.length > 0) {
      this.logger.warn(`Swept ${stale.length} abandoned session(s)`);
    }
    return stale.length;
  }
}
