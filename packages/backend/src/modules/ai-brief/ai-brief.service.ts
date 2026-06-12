import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AnalyticsBriefEntity } from '../../database/entities/analytics-brief.entity';
import { BriefFindingsService } from './brief-findings.service';
import { BRIEF_NARRATOR, BriefNarrator, renderTemplateBrief } from './brief-narrator.interface';
import { verifyBriefProvenance } from './brief-provenance.util';
import { guardedProjectionUpsert } from '../analytics-projection/projection-upsert.util';

export interface BriefResult {
  businessDay: string;
  text: string | null;
  /** 'rendered' | 'fallback' | 'no_data' | 'rejected' */
  status: string;
  computedAt: string | null;
}

/**
 * Étage 3 — brief generation: findings (deterministic) → narrator (untrusted seam)
 * → PROVENANCE GUARD → persist/serve. An unverifiable narration is NEVER served:
 * it falls back to the deterministic template (itself guard-checked — belt), or to
 * no brief at all. Cache keyed (scope, business_day, computed_at): regenerated only
 * when the projection freshness advances (the étage-0 monotonic anchor) — the
 * narrator is not re-called per request and the prose is stable within a window.
 */
@Injectable()
export class AiBriefService {
  private readonly logger = new Logger(AiBriefService.name);

  constructor(
    private readonly findingsService: BriefFindingsService,
    @Inject(BRIEF_NARRATOR) private readonly narrator: BriefNarrator,
    @InjectRepository(AnalyticsBriefEntity) private readonly briefs: Repository<AnalyticsBriefEntity>,
  ) {}

  async getOrGenerate(scope: string[], businessDay: string): Promise<BriefResult> {
    const findings = await this.findingsService.build(scope, businessDay);
    if (!findings.computedAt) {
      return { businessDay, text: null, status: 'no_data', computedAt: null }; // nothing fabricated
    }
    const freshness = new Date(findings.computedAt);
    const scopeKey = keyOfScope(scope);

    // ── cache: same (scope, day) and the projection has NOT advanced → serve as-is ──
    const cached = await this.briefs.findOne({ where: { scopeKey, businessDay } });
    if (cached && new Date(cached.computedAt).getTime() >= freshness.getTime()) {
      return { businessDay, text: cached.text, status: cached.status, computedAt: new Date(cached.computedAt).toISOString() };
    }

    // ── render through the untrusted seam, then the provenance guard ──
    let text = '';
    let status = 'rendered';
    try {
      text = await this.narrator.render(findings);
    } catch (e: any) {
      this.logger.warn(`brief narrator failed (${e?.message}) — falling back to template`);
      text = '';
    }
    if (!text || !verifyBriefProvenance(findings, text).valid) {
      const check = text ? verifyBriefProvenance(findings, text) : { untraceable: ['(empty)'] };
      this.logger.warn(
        `brief provenance REJECTED [${(check as any).untraceable?.join(', ')}] — serving the deterministic template instead`,
      );
      text = renderTemplateBrief(findings);
      status = 'fallback';
      if (!verifyBriefProvenance(findings, text).valid) {
        // The template is provenance-clean by construction; this is the belt.
        this.logger.warn('template brief failed provenance — serving NO brief');
        return { businessDay, text: null, status: 'rejected', computedAt: findings.computedAt };
      }
    }

    await guardedProjectionUpsert(
      this.briefs,
      { scopeKey, businessDay },
      { scopeKey, businessDay, computedAt: freshness, findings: findings as unknown as Record<string, unknown>, text, status },
      freshness,
      this.logger,
      'analytics.briefs',
    );
    return { businessDay, text, status, computedAt: findings.computedAt };
  }
}

const keyOfScope = (scope: string[]): string =>
  createHash('sha256').update([...scope].sort().join(',')).digest('hex');
