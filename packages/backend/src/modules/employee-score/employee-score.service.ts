import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { EmployeeScoreEventEntity } from '../../database/entities/employee-score-event.entity';
import { EmployeeScoreRuleEntity } from '../../database/entities/employee-score-rule.entity';
import { EmployeeScoreDailyEntity } from '../../database/entities/employee-score-daily.entity';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { AuditService } from '../audit/audit.service';
import {
  DEFAULT_SCORE_RULES,
  SCORE_CATEGORIES,
  SCORE_BASELINE,
  SCORE_RULES_VERSION,
  ScoreCategory,
  ScoreEventType,
  ScoreRule,
  requiresValidSession,
  scoreColor,
} from './employee-score.constants';

export interface LogScoreEventInput {
  employeeId: string;
  storeId: string;
  eventType: ScoreEventType | string;
  terminalId?: string | null;
  sessionId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  createdBy?: string | null;
  source?: string;
  /**
   * Quand vrai (chemin client POS), le backend VÉRIFIE que `sessionId`
   * correspond à une session active du terminal pour l'employé, pour les faits
   * sensibles (voir SESSION_BOUND_EVENT_TYPES). Un fait sensible sans session
   * valide est requalifié en ACTION_WITHOUT_VALID_SESSION. Les émetteurs
   * backend autoritatifs (product-integration, stock-reconciliation, cycle de
   * vie de session, cron) laissent ce flag à false.
   */
  enforceSession?: boolean;
}

export interface ScoreBreakdown {
  total: number;
  color: string;
  categories: Record<ScoreCategory, { score: number; max: number; label: string }>;
  eventCount: number;
}

export type ScorePeriod = 'day' | 'week' | 'year';

/** Local (Europe/Paris) calendar helpers — string comparison-safe. */
const PARIS_TZ = 'Europe/Paris';

function parisParts(d: Date): { y: number; m: number; day: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    y: parseInt(get('year'), 10),
    m: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    weekday: weekdayMap[get('weekday')] ?? 1,
  };
}

/** Paris YYYY-MM-DD for a Date. */
export function parisDateStr(d: Date): string {
  const p = parisParts(d);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Offset (ms) of Europe/Paris relative to UTC at a given instant (DST-aware). */
function parisOffsetMs(instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: PARIS_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) m[p.type] = p.value;
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second);
  return asUtc - instant.getTime();
}

/**
 * UTC instant whose Europe/Paris wall-clock is 00:00 on the given Paris date.
 * Correct across DST — the day boundary is anchored to Paris, not to the
 * server's local timezone (which otherwise silently shifted the score window
 * near midnight, e.g. every score read between 22:00–24:00 UTC).
 */
function parisMidnightUtc(y: number, m: number, day: number): Date {
  const guessMs = Date.UTC(y, m - 1, day, 0, 0, 0);
  // Two-step refine handles the DST-transition edge.
  let start = new Date(guessMs - parisOffsetMs(new Date(guessMs)));
  start = new Date(guessMs - parisOffsetMs(start));
  return start;
}

/** Paris 00:00 of the calendar day AFTER the given Paris-midnight instant. */
function parisNextDayMidnightUtc(parisMidnight: Date): Date {
  const p = parisParts(new Date(parisMidnight.getTime() + 36 * 3600 * 1000)); // safely into next day
  return parisMidnightUtc(p.y, p.m, p.day);
}

@Injectable()
export class EmployeeScoreService {
  private readonly logger = new Logger(EmployeeScoreService.name);

  constructor(
    @InjectRepository(EmployeeScoreEventEntity)
    private eventRepo: Repository<EmployeeScoreEventEntity>,
    @InjectRepository(EmployeeScoreRuleEntity)
    private ruleRepo: Repository<EmployeeScoreRuleEntity>,
    @InjectRepository(EmployeeScoreDailyEntity)
    private dailyRepo: Repository<EmployeeScoreDailyEntity>,
    @InjectRepository(PosSessionEntity)
    private sessionRepo: Repository<PosSessionEntity>,
    private auditService: AuditService,
  ) {}

  /**
   * Vérifie qu'un fait sensible est bien rattaché à une session caisse réelle.
   * Retourne :
   *  - 'valid'        : sessionId posté = session ACTIVE du terminal, même employé
   *  - 'invalid'      : session manquante / terminal absent / mismatch id ou employé
   *  - 'unverifiable' : la lecture DB a échoué (on ne fabrique pas d'anomalie)
   */
  private async validateSession(input: LogScoreEventInput): Promise<'valid' | 'invalid' | 'unverifiable'> {
    const terminalId = input.terminalId ?? null;
    const sessionId = input.sessionId ?? null;
    // Un fait sensible qui ne porte ni terminal ni session ne peut pas être rattaché.
    if (!terminalId || !sessionId) return 'invalid';
    let session: PosSessionEntity | null;
    try {
      session = await this.sessionRepo.findOne({
        where: { storeId: input.storeId, terminalId, isActive: true },
      });
    } catch (err) {
      this.logger.warn(`validateSession read failed (${input.eventType}): ${err}`);
      return 'unverifiable';
    }
    if (!session) return 'invalid';
    if (session.id !== sessionId) return 'invalid';
    if (session.employeeId !== input.employeeId) return 'invalid';
    return 'valid';
  }

  /** Merge DB rule overrides over the versioned defaults. */
  private async resolveRules(): Promise<Record<string, ScoreRule>> {
    const merged: Record<string, ScoreRule> = { ...DEFAULT_SCORE_RULES };
    let overrides: EmployeeScoreRuleEntity[] = [];
    try {
      overrides = await this.ruleRepo.find({ where: { enabled: true } });
    } catch {
      overrides = []; // table may not exist yet in a partial env → defaults only
    }
    for (const r of overrides) {
      merged[r.eventType] = {
        category: r.category as ScoreCategory,
        pointsDelta: r.pointsDelta,
        severity: r.severity as ScoreRule['severity'],
        maxDailyPenalty: r.maxDailyPenalty,
        alert: r.alert,
        label: r.label,
      };
    }
    return merged;
  }

  // ── Event logging (POS event logger) ───────────────────────────

  /**
   * Enregistre un fait POS probant et applique la règle correspondante. Écrit
   * dans le ledger score ET dans la chaîne d'audit (immuable). Ne jette jamais :
   * un échec de scoring ne doit pas casser un flux de vente.
   */
  async logEvent(input: LogScoreEventInput): Promise<EmployeeScoreEventEntity | null> {
    try {
      // Garde serveur : un fait sensible du chemin POS doit être rattaché à une
      // session caisse réelle. Sinon on le requalifie en anomalie technique —
      // on ne fait PAS confiance au sessionId envoyé par le client seul.
      let eventType: string = input.eventType;
      let reason = input.reason ?? null;
      let metadata: Record<string, unknown> | null = input.metadata ?? null;
      if (input.enforceSession && requiresValidSession(input.eventType)) {
        const verdict = await this.validateSession(input);
        if (verdict === 'invalid') {
          metadata = {
            ...(input.metadata ?? {}),
            claimedEventType: input.eventType,
            claimedSessionId: input.sessionId ?? null,
            claimedTerminalId: input.terminalId ?? null,
          };
          reason = `Action « ${input.eventType} » jouée sans session caisse valide`;
          eventType = 'ACTION_WITHOUT_VALID_SESSION';
        } else if (verdict === 'unverifiable') {
          metadata = { ...(input.metadata ?? {}), sessionVerification: 'unverifiable' };
        }
      }

      const rules = await this.resolveRules();
      const rule = rules[eventType] ?? {
        category: 'procedure' as ScoreCategory,
        pointsDelta: 0,
        severity: 'info' as const,
        maxDailyPenalty: 0,
        alert: false,
        label: eventType,
      };

      const event = await this.eventRepo.save(
        this.eventRepo.create({
          employeeId: input.employeeId,
          storeId: input.storeId,
          terminalId: input.terminalId ?? null,
          sessionId: input.sessionId ?? null,
          eventType,
          category: rule.category,
          severity: rule.severity,
          pointsDelta: rule.pointsDelta,
          reason,
          metadata,
          createdBy: input.createdBy ?? input.employeeId,
          source: input.source ?? 'pos',
          ruleVersion: SCORE_RULES_VERSION,
        }),
      );

      // Mirror to the immutable audit chain (best-effort — never blocks).
      await this.auditService
        .log({
          storeId: input.storeId,
          employeeId: input.employeeId,
          action: 'score_event',
          entityType: 'employee_score',
          entityId: event.id,
          details: {
            eventType,
            category: rule.category,
            severity: rule.severity,
            pointsDelta: rule.pointsDelta,
            terminalId: input.terminalId ?? null,
            sessionId: input.sessionId ?? null,
            reason,
          },
        })
        .catch(() => undefined);

      return event;
    } catch (err) {
      this.logger.error(`logEvent failed for ${input.eventType}: ${err}`);
      return null;
    }
  }

  // ── Score computation ──────────────────────────────────────────

  private emptyBreakdown(): ScoreBreakdown {
    const categories = {} as ScoreBreakdown['categories'];
    for (const key of Object.keys(SCORE_CATEGORIES) as ScoreCategory[]) {
      categories[key] = { score: SCORE_CATEGORIES[key].max, max: SCORE_CATEGORIES[key].max, label: SCORE_CATEGORIES[key].label };
    }
    return { total: SCORE_BASELINE, color: scoreColor(SCORE_BASELINE), categories, eventCount: 0 };
  }

  /**
   * Calcule un score sur une plage [start, end). Applique le plafond de pénalité
   * par jour et par type (maxDailyPenalty), puis répartit par catégorie. Le
   * panier « régularité » agrège la récidive (mêmes pénalités répétées sur ≥3 jours).
   */
  private async computeRange(
    employeeId: string,
    start: Date,
    end: Date,
    rules: Record<string, ScoreRule>,
  ): Promise<ScoreBreakdown> {
    const events = await this.eventRepo.find({
      where: { employeeId, createdAt: Between(start, end) },
      order: { createdAt: 'ASC' },
    });
    if (events.length === 0) return this.emptyBreakdown();

    // Group by (localDay, eventType) to apply the per-day penalty cap.
    const groups = new Map<string, { type: string; day: string; sum: number }>();
    for (const ev of events) {
      if (ev.pointsDelta === 0) continue;
      const day = parisDateStr(ev.createdAt);
      const key = `${day}|${ev.eventType}`;
      const g = groups.get(key) ?? { type: ev.eventType, day, sum: 0 };
      g.sum += ev.pointsDelta;
      groups.set(key, g);
    }

    const breakdown = this.emptyBreakdown();
    breakdown.eventCount = events.length;

    // Track penalty occurrences per type/day for the regularity category.
    const penaltyDaysByType = new Map<string, Set<string>>();

    for (const g of groups.values()) {
      const rule = rules[g.type];
      if (!rule) continue;
      let delta = g.sum;
      // Cap the accumulated penalty for this type on this day.
      if (rule.maxDailyPenalty > 0 && delta < 0) {
        delta = Math.max(delta, -rule.maxDailyPenalty);
      }
      const cat = rule.category;
      breakdown.categories[cat].score += delta; // delta is negative for penalties

      if (delta < 0) {
        const set = penaltyDaysByType.get(g.type) ?? new Set<string>();
        set.add(g.day);
        penaltyDaysByType.set(g.type, set);
      }
    }

    // Regularity: repeated same-penalty on ≥3 distinct days → extra deduction.
    let regularityPenalty = 0;
    for (const set of penaltyDaysByType.values()) {
      if (set.size >= 3) regularityPenalty -= 2 * (set.size - 2);
    }
    breakdown.categories.regularity.score += regularityPenalty;

    // Clamp each category to [0, max] and sum.
    let total = 0;
    for (const key of Object.keys(breakdown.categories) as ScoreCategory[]) {
      const c = breakdown.categories[key];
      c.score = Math.max(0, Math.min(c.max, Math.round(c.score)));
      total += c.score;
    }
    breakdown.total = Math.max(0, Math.min(SCORE_BASELINE, total));
    breakdown.color = scoreColor(breakdown.total);
    return breakdown;
  }

  /**
   * Plage [start, end] pour la période demandée, ancrée sur maintenant (Paris).
   * Les bornes sont des instants UTC correspondant à minuit Paris — sinon le
   * fuseau du serveur décalait la fenêtre de score autour de minuit (bug réel :
   * un score « du jour » lu entre 22:00 et 24:00 UTC ratait les faits du jour).
   */
  private periodRange(period: ScorePeriod, now: Date): { start: Date; end: Date } {
    const p = parisParts(now);
    const end = now;
    if (period === 'day') {
      return { start: parisMidnightUtc(p.y, p.m, p.day), end };
    }
    if (period === 'week') {
      // Monday of the current Paris week: step back (weekday-1) days from today's
      // Paris midnight, then re-anchor to that day's Paris midnight (DST-safe).
      const todayStart = parisMidnightUtc(p.y, p.m, p.day);
      const mondayApprox = new Date(todayStart.getTime() - (p.weekday - 1) * 24 * 3600 * 1000);
      const mp = parisParts(mondayApprox);
      return { start: parisMidnightUtc(mp.y, mp.m, mp.day), end };
    }
    // year → Jan 1 (Paris).
    return { start: parisMidnightUtc(p.y, 1, 1), end };
  }

  async getScore(employeeId: string, period: ScorePeriod, now: Date = new Date()): Promise<ScoreBreakdown> {
    const rules = await this.resolveRules();
    const { start, end } = this.periodRange(period, now);
    return this.computeRange(employeeId, start, end, rules);
  }

  /** Score jour + semaine + année en un appel (pour l'affichage POS). */
  async getScoreSummary(employeeId: string, now: Date = new Date()) {
    const [day, week, year] = await Promise.all([
      this.getScore(employeeId, 'day', now),
      this.getScore(employeeId, 'week', now),
      this.getScore(employeeId, 'year', now),
    ]);
    return { day, week, year };
  }

  /** Détail: breakdown jour + N événements récents (wording factuel côté client). */
  async getDetail(employeeId: string, now: Date = new Date(), recentLimit = 15) {
    const day = await this.getScore(employeeId, 'day', now);
    const recent = await this.eventRepo.find({
      where: { employeeId },
      order: { createdAt: 'DESC' },
      take: recentLimit,
    });
    return {
      day,
      recentEvents: recent.map((e) => ({
        eventType: e.eventType,
        category: e.category,
        severity: e.severity,
        pointsDelta: e.pointsDelta,
        reason: e.reason,
        terminalId: e.terminalId,
        sessionId: e.sessionId,
        createdAt: e.createdAt,
      })),
    };
  }

  // ── Manager alerts ─────────────────────────────────────────────

  /** Faits importants récents (règles marquées alert) pour un magasin. */
  async getAlerts(storeId: string, sinceHours = 72, limit = 100) {
    const rules = await this.resolveRules();
    const alertTypes = Object.entries(rules)
      .filter(([, r]) => r.alert)
      .map(([type]) => type);
    if (alertTypes.length === 0) return [];
    const since = new Date(Date.now() - sinceHours * 3600 * 1000);
    const rows = await this.eventRepo
      .createQueryBuilder('e')
      .where('e.store_id = :storeId', { storeId })
      .andWhere('e.event_type IN (:...types)', { types: alertTypes })
      .andWhere('e.created_at >= :since', { since })
      .orderBy('e.created_at', 'DESC')
      .take(limit)
      .getMany();
    return rows;
  }

  // ── Team scores (manager cockpit) ──────────────────────────────

  /**
   * Tableau des scores de l'équipe d'un magasin : les employés ayant produit des
   * faits probants dans ce magasin sur la fenêtre, avec leur score jour + semaine
   * (dérivé du ledger, jamais approximé), leur volume d'événements et leur
   * dernière activité. Trié du plus faible score du jour au plus fort (les cas à
   * regarder d'abord). Le nom est résolu en best-effort via la dernière session.
   */
  async getTeamScores(storeId: string, now: Date = new Date(), sinceDays = 7) {
    const since = new Date(now.getTime() - sinceDays * 24 * 3600 * 1000);
    const rows = await this.eventRepo
      .createQueryBuilder('e')
      .select('e.employee_id', 'employeeId')
      .addSelect('MAX(e.created_at)', 'lastActivity')
      .addSelect('COUNT(*)', 'eventCount')
      .where('e.store_id = :storeId', { storeId })
      .andWhere('e.created_at >= :since', { since })
      .groupBy('e.employee_id')
      .getRawMany<{ employeeId: string; lastActivity: Date; eventCount: string }>();

    const team = [];
    for (const r of rows) {
      const [day, week] = await Promise.all([
        this.getScore(r.employeeId, 'day', now),
        this.getScore(r.employeeId, 'week', now),
      ]);
      let employeeName: string | null = null;
      try {
        const s = await this.sessionRepo.findOne({
          where: { storeId, employeeId: r.employeeId },
          order: { openedAt: 'DESC' },
        });
        employeeName = s?.employeeName ?? null;
      } catch {
        employeeName = null; // le nom est indicatif — jamais bloquant
      }
      team.push({
        employeeId: r.employeeId,
        employeeName,
        day: { total: day.total, color: day.color },
        week: { total: week.total, color: week.color },
        eventCount: Number(r.eventCount),
        lastActivity: r.lastActivity,
      });
    }
    team.sort((a, b) => a.day.total - b.day.total);
    return team;
  }

  // ── Nightly recompute (cron target) ────────────────────────────

  /** Recalcule et upsert l'agrégat journalier d'un employé pour une date. */
  async recomputeDaily(employeeId: string, storeId: string, scoreDate: string, now: Date = new Date()) {
    const rules = await this.resolveRules();
    const [yy, mm, dd] = scoreDate.split('-').map(Number);
    const start = parisMidnightUtc(yy, mm, dd);
    const end = new Date(parisNextDayMidnightUtc(start).getTime() - 1); // 23:59:59.999 Paris
    const b = await this.computeRange(employeeId, start, end, rules);

    const existing = await this.dailyRepo.findOne({ where: { employeeId, scoreDate } });
    const row = existing ?? this.dailyRepo.create({ employeeId, storeId, scoreDate });
    row.storeId = storeId;
    row.scoreTotal = b.total;
    row.scoreColor = b.color;
    row.sessionScore = b.categories.session.score;
    row.cashScore = b.categories.cash.score;
    row.procedureScore = b.categories.procedure.score;
    row.inventoryScore = b.categories.inventory.score;
    row.scheduleScore = b.categories.schedule.score;
    row.regularityScore = b.categories.regularity.score;
    row.eventCount = b.eventCount;
    row.calculatedAt = now;
    row.ruleVersion = SCORE_RULES_VERSION;
    return this.dailyRepo.save(row);
  }

  /** Balaye les employés ayant produit des événements sur `scoreDate` et recompute. */
  async recomputeAllForDate(scoreDate: string, now: Date = new Date()): Promise<number> {
    const [yy, mm, dd] = scoreDate.split('-').map(Number);
    const start = parisMidnightUtc(yy, mm, dd);
    const end = new Date(parisNextDayMidnightUtc(start).getTime() - 1);
    const pairs = await this.eventRepo
      .createQueryBuilder('e')
      .select('e.employee_id', 'employeeId')
      .addSelect('e.store_id', 'storeId')
      .where('e.created_at BETWEEN :start AND :end', { start, end })
      .groupBy('e.employee_id')
      .addGroupBy('e.store_id')
      .getRawMany();
    for (const p of pairs) {
      await this.recomputeDaily(p.employeeId, p.storeId, scoreDate, now);
    }
    return pairs.length;
  }
}
