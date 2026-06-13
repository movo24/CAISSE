import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReadOnlyGuard } from '../mobile-read-api/read-only.guard';
import { StoreScopeResolverService } from '../analytics-projection/store-scope-resolver.service';
import { AiBriefService, BriefResult } from './ai-brief.service';

/**
 * Étage 3 closure — GET /mobile/v1/ai-brief (collection rule: silently scoped).
 * Same guards as the rest of the cockpit surface (auth + INV-1 GET-only). Serves
 * the persisted, provenance-verified brief for the caller's scope; generation
 * happens only when the projection freshness advanced (computed_at cache).
 */
@Controller('mobile/v1')
@UseGuards(JwtAuthGuard, ReadOnlyGuard)
export class AiBriefController {
  constructor(
    private readonly scopeResolver: StoreScopeResolverService,
    private readonly aiBrief: AiBriefService,
  ) {}

  @Get('ai-brief')
  async brief(@Req() req: any): Promise<BriefResult> {
    const u = req?.user ?? {};
    const scope = await this.scopeResolver.resolveAccessibleStoreIds({
      employeeId: u.employeeId,
      storeId: u.storeId,
      role: u.role,
    });
    return this.aiBrief.getOrGenerate(scope, this.now());
  }

  /** Clock seam (deterministic in tests). */
  protected now(): Date {
    return new Date();
  }
}
