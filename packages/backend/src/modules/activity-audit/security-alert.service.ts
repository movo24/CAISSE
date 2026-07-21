import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserLoginEventEntity } from '../../database/entities/user-login-event.entity';
import { UserViewEventEntity } from '../../database/entities/user-view-event.entity';
import { AlertService } from '../../common/alert/alert.service';
import { assessLoginRisk, LoginSignal, RISK_ALERT_THRESHOLD } from './security-alert.evaluator';

/** Nb de refus d'accès magasin (ACCESS_DENIED) sur la fenêtre déclenchant une alerte. */
const DENIED_BURST_THRESHOLD = 5;
const DENIED_BURST_WINDOW_MS = 10 * 60 * 1000;

/**
 * Analyse de sécurité (spec §14) — score de risque EXPLICABLE, jamais de blocage
 * automatique sur simple changement de ville. Toutes les méthodes sont NON BLOQUANTES.
 */
@Injectable()
export class SecurityAlertService {
  private readonly logger = new Logger(SecurityAlertService.name);

  constructor(
    @InjectRepository(UserLoginEventEntity)
    private readonly loginRepo: Repository<UserLoginEventEntity>,
    @InjectRepository(UserViewEventEntity)
    private readonly viewRepo: Repository<UserViewEventEntity>,
  ) {}

  /**
   * Évalue le risque d'un login qui vient d'être enregistré, écrit le risk_score et lève
   * une alerte explicable si le seuil est atteint. Ne lève jamais.
   */
  async assessAndAlert(employeeId: string | null, currentEventId: string): Promise<number> {
    if (!employeeId) return 0;
    try {
      const events = await this.loginRepo.find({
        where: { employeeId },
        order: { occurredAt: 'DESC' },
        take: 100,
      });
      const current = events.find((e) => e.id === currentEventId);
      if (!current) return 0;
      const history = events.filter((e) => e.id !== currentEventId);
      const { riskScore, reasons } = assessLoginRisk(toSignal(current), history.map(toSignal));

      if (riskScore !== current.riskScore) {
        await this.loginRepo.update(current.id, { riskScore });
      }
      if (riskScore >= RISK_ALERT_THRESHOLD) {
        AlertService.instance.fire(
          'LOGIN_RISK_HIGH',
          `Login risqué employé ${employeeId} — score ${riskScore} [${reasons.join(', ')}]`,
        );
      }
      return riskScore;
    } catch (e) {
      this.logger.warn(`[SECURITY] assessAndAlert failed (non-blocking): ${(e as Error)?.message}`);
      return 0;
    }
  }

  /** Détecte un afflux de tentatives d'accès magasin refusées (ACCESS_DENIED). Non bloquant. */
  async checkAccessDeniedBurst(employeeId: string | null, now: Date = new Date()): Promise<boolean> {
    if (!employeeId) return false;
    try {
      const since = new Date(now.getTime() - DENIED_BURST_WINDOW_MS);
      const count = await this.viewRepo
        .createQueryBuilder('v')
        .where('v.employeeId = :eid', { eid: employeeId })
        .andWhere('v.action = :a', { a: 'ACCESS_DENIED' })
        .andWhere('v.occurredAt >= :since', { since })
        .getCount();
      if (count >= DENIED_BURST_THRESHOLD) {
        AlertService.instance.fire(
          'ACCESS_DENIED_BURST',
          `Afflux de refus d'accès magasin — employé ${employeeId}: ${count} en 10 min`,
        );
        return true;
      }
      return false;
    } catch (e) {
      this.logger.warn(`[SECURITY] checkAccessDeniedBurst failed (non-blocking): ${(e as Error)?.message}`);
      return false;
    }
  }
}

function toSignal(e: UserLoginEventEntity): LoginSignal {
  return { success: e.success, countryCode: e.countryCode, userAgent: e.userAgent, occurredAt: e.occurredAt };
}
