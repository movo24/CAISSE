import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AnalyticsBriefEntity } from '../../database/entities/analytics-brief.entity';
import { AnalyticsStoreClockEntity } from '../../database/entities/analytics-store-clock.entity';
import { BriefFindingsService } from './brief-findings.service';
import { BRIEF_NARRATOR, BriefNarrator, renderTemplateBrief } from './brief-narrator.interface';
import { verifyBriefProvenance } from './brief-provenance.util';
import { guardedProjectionUpsert } from '../analytics-projection/projection-upsert.util';
import { localDayString, localHourOf } from '../../common/clock/wall-clock.util';

export interface BriefResult {
  businessDay: string;
  /** The beat this brief belongs to (wall-clock hour from store_clock); null = none yet. */
  beat: number | null;
  text: string | null;
  /** 'rendered' | 'fallback' | 'no_data' | 'rejected' | 'awaiting_first_beat' */
  status: string;
  computedAt: string | null;
}

/**
 * Étage 3 — brief generation on SCHEDULED BEATS (ratified): findings → narrator
 * (untrusted seam) → PROVENANCE GUARD → persist/serve, keyed (scope, business_day,
 * beat). A brief regenerates only AT a beat (hours from analytics.store_clock —
 * the single wall-clock datum, UTC stand-in); between beats the persisted row is
 * served as-is, so the prose never moves under the executive's eyes AND a partial
 * morning is never narrated against full prior days outside its beat.
 *
 * Failure corollary (ratified): a beat that fails (LLM down OR guard rejection)
 * persists the TEMPLATE under the same beat key — held until the NEXT beat, never
 * retried. Before the day's first beat, the latest persisted brief (e.g.
 * yesterday's close) stays served — stable overnight.
 */
@Injectable()
export class AiBriefService {
  private readonly logger = new Logger(AiBriefService.name);

  constructor(
    private readonly findingsService: BriefFindingsService,
    @Inject(BRIEF_NARRATOR) private readonly narrator: BriefNarrator,
    @InjectRepository(AnalyticsBriefEntity) private readonly briefs: Repository<AnalyticsBriefEntity>,
    @InjectRepository(AnalyticsStoreClockEntity) private readonly clock: Repository<AnalyticsStoreClockEntity>,
  ) {}

  async getOrGenerate(scope: string[], now: Date = new Date()): Promise<BriefResult> {
    const scopeKey = keyOfScope(scope);

    // ── which beat are we in? A1: LOCAL wall-clock in the clock datum's IANA
    //    timezone (DST-correct); the business day is the LOCAL calendar day. ──
    const clock = await this.clock.findOne({ where: { storeId: IsNull(), isActive: true } });
    const tz = clock?.timezone ?? 'Etc/UTC'; // no datum → degraded UTC labelling (nothing generated anyway)
    const businessDay = localDayString(now, tz);
    const beats = clock ? [...(clock.briefBeatHours ?? []), clock.closeHour].sort((a, b) => a - b) : [];
    const passed = beats.filter((h) => h <= localHourOf(now, tz));

    if (passed.length === 0) {
      // Before the first beat (or no clock datum): the stable text is the latest
      // persisted brief — typically yesterday's close. Nothing is generated.
      const latest = await this.briefs.findOne({
        where: { scopeKey },
        order: { businessDay: 'DESC', beat: 'DESC' },
      });
      if (latest) return toResult(latest);
      return { businessDay, beat: null, text: null, status: 'awaiting_first_beat', computedAt: null };
    }
    const beat = Math.max(...passed);

    // ── stable between beats: the persisted row for THIS beat is served as-is —
    //    including a 'fallback' row (corollary: held until the next beat, no retry). ──
    const cached = await this.briefs.findOne({ where: { scopeKey, businessDay, beat } });
    if (cached) return toResult(cached);

    // ── first request at/after the beat → generate once ──
    const findings = await this.findingsService.build(scope, businessDay);
    if (!findings.computedAt) {
      return { businessDay, beat, text: null, status: 'no_data', computedAt: null }; // nothing fabricated
    }
    const freshness = new Date(findings.computedAt);

    let text = '';
    let status = 'rendered';
    try {
      text = await this.narrator.render(findings);
    } catch (e: any) {
      this.logger.warn(`brief narrator failed at beat ${beat} (${e?.message}) — falling back to template`);
      text = '';
    }
    if (!text || !verifyBriefProvenance(findings, text).valid) {
      const check = text ? verifyBriefProvenance(findings, text) : { untraceable: ['(empty)'] };
      this.logger.warn(
        `brief provenance REJECTED at beat ${beat} [${(check as any).untraceable?.join(', ')}] — template held until the next beat`,
      );
      text = renderTemplateBrief(findings);
      status = 'fallback';
      if (!verifyBriefProvenance(findings, text).valid) {
        // The template is provenance-clean by construction; this is the belt.
        this.logger.warn('template brief failed provenance — serving NO brief');
        return { businessDay, beat, text: null, status: 'rejected', computedAt: findings.computedAt };
      }
    }

    await guardedProjectionUpsert(
      this.briefs,
      { scopeKey, businessDay, beat },
      {
        scopeKey,
        businessDay,
        beat,
        computedAt: freshness,
        findings: findings as unknown as Record<string, unknown>,
        text,
        status,
      },
      freshness,
      this.logger,
      'analytics.briefs',
    );
    return { businessDay, beat, text, status, computedAt: findings.computedAt };
  }
}

const toResult = (row: AnalyticsBriefEntity): BriefResult => ({
  businessDay: String(row.businessDay),
  beat: row.beat,
  text: row.text,
  status: row.status,
  computedAt: new Date(row.computedAt).toISOString(),
});

const keyOfScope = (scope: string[]): string =>
  createHash('sha256').update([...scope].sort().join(',')).digest('hex');
