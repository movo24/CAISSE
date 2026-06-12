import { Controller, Get, Logger, NotFoundException, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReadOnlyGuard } from './read-only.guard';
import { StoreScopeResolverService } from '../analytics-projection/store-scope-resolver.service';
import { MobileReadService } from './mobile-read.service';

/**
 * Wesley Command Center — étage 1 (mobile-read-api). GET-only cockpit read surface.
 *
 * Auth (`JwtAuthGuard`) + INV-1 read-only (`ReadOnlyGuard`) on the WHOLE controller.
 * Every handler reads ONLY `analytics.*` (via MobileReadService) and scopes at the
 * QUERY layer (INV-5). Scope rule (decided): a COLLECTION is silently shaped by the
 * scope; a RESOURCE :id outside the scope → 404 (indistinguishable from a genuinely
 * missing store — anti-enumeration) + a server-side WARN (the forge attempt is the
 * audit signal). One error path.
 */
@Controller('mobile/v1')
@UseGuards(JwtAuthGuard, ReadOnlyGuard)
export class MobileReadController {
  private readonly logger = new Logger(MobileReadController.name);

  constructor(
    private readonly scopeResolver: StoreScopeResolverService,
    private readonly read: MobileReadService,
  ) {}

  @Get('stores')
  async stores(@Req() req: any) {
    const scope = await this.scopeOf(req);
    return this.read.listStores(scope);
  }

  @Get('dashboard/overview')
  async overview(@Req() req: any) {
    const scope = await this.scopeOf(req);
    const today = new Date().toISOString().slice(0, 10);
    return this.read.overview(scope, today);
  }

  @Get('alerts')
  async alerts(@Req() req: any) {
    const scope = await this.scopeOf(req);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    return this.read.listAlerts(scope, today, yesterday);
  }

  @Get('stores/:id/live')
  async live(@Param('id') id: string, @Req() req: any) {
    const scope = await this.scopeOf(req);
    this.ensureInScope(id, scope, req); // 404 + log if out of scope (= if non-existent)
    return this.read.liveForStore(id);
  }

  @Get('stores/:id/performance')
  async performance(@Param('id') id: string, @Req() req: any) {
    const scope = await this.scopeOf(req);
    this.ensureInScope(id, scope, req); // 404 + log if out of scope (= if non-existent)
    const today = new Date().toISOString().slice(0, 10);
    return this.read.performanceForStore(id, today);
  }

  // ── helpers ──

  private scopeOf(req: any): Promise<string[]> {
    const u = req?.user ?? {};
    return this.scopeResolver.resolveAccessibleStoreIds({
      employeeId: u.employeeId,
      storeId: u.storeId,
      role: u.role,
    });
  }

  /**
   * RESOURCE guard: a :id outside the scope is 404 (NOT 403 — no existence leak) and
   * the attempt is logged. The thrown `NotFoundException()` is the DEFAULT one, so the
   * out-of-scope 404 body is identical to a genuinely-missing store's 404.
   */
  private ensureInScope(storeId: string, scope: string[], req: any): void {
    if (!scope.includes(storeId)) {
      this.logger.warn(
        `[mobile] out-of-scope store request — user=${req?.user?.employeeId ?? 'unknown'} ` +
          `store=${storeId} scope=[${scope.join(',')}]`,
      );
      throw new NotFoundException();
    }
  }
}
