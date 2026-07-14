import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { MobileAnalyticsService } from './mobile-analytics.service';
import { parseWindow } from './analytics';

/**
 * P366 — Mobile network analytics API (READ-ONLY, GET only).
 *
 * The mobile pilot app consumes exclusively these endpoints: it observes,
 * compares and analyses — it never commands. No POST/PUT/PATCH/DELETE is
 * declared here on purpose; adding one is a design violation (POS-113).
 *
 * Guards: EMPLOYEE JWT + RolesGuard (manager/admin) — never the customer
 * mobile token. Tenant scoping:
 *   - manager  → always locked to their own store (JWT storeId);
 *   - admin    → network-wide by default, or any single store via ?storeId=.
 */
@ApiTags('mobile-analytics')
@ApiBearerAuth()
@Controller('mobile/v1/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MobileAnalyticsController {
  constructor(private readonly service: MobileAnalyticsService) {}

  /** manager → own store; admin → requested store or null (network). */
  private scope(req: any, storeId?: string): string | null {
    if (req.user.role === 'admin') return storeId || null;
    return req.user.storeId;
  }

  private window(from?: string, to?: string): { from: string; to: string } {
    try {
      const w = parseWindow(from, to);
      return { from: w.from.toISOString(), to: w.to.toISOString() };
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
  }

  @Get('overview')
  @Roles('manager')
  @ApiOperation({ summary: 'KPIs réseau/magasin + comparaisons période précédente et N-1 (lecture seule)' })
  overview(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeId') storeId?: string,
    @Query('tz') tz?: string,
  ) {
    const w = this.window(from, to);
    return this.service.getOverview(w.from, w.to, this.scope(req, storeId), tz);
  }

  @Get('revenue-windows')
  @Roles('manager')
  @ApiOperation({ summary: 'CA jour/hier/semaine/mois/semestre/année (fenêtres calendaires, lecture seule)' })
  revenueWindows(
    @Req() req: any,
    @Query('storeId') storeId?: string,
    @Query('tz') tz?: string,
  ) {
    return this.service.getRevenueWindows(this.scope(req, storeId), tz);
  }

  @Get('stores')
  @Roles('manager')
  @ApiOperation({ summary: 'Classement des points de vente (CA, progression, panier, remise, avoirs…)' })
  stores(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sort') sort?: string,
    @Query('storeId') storeId?: string,
    @Query('tz') tz?: string,
  ) {
    const w = this.window(from, to);
    return this.service.getStoreRanking(w.from, w.to, this.scope(req, storeId), sort, tz);
  }

  @Get('stores/:id')
  @Roles('manager')
  @ApiOperation({ summary: 'Fiche détaillée d’un point de vente (séries, top/flop, catégories, rang réseau)' })
  storeDetail(
    @Req() req: any,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('tz') tz?: string,
  ) {
    const w = this.window(from, to);
    // Manager: fiche de SON magasin uniquement (jamais un autre tenant).
    const effectiveId = req.user.role === 'admin' ? id : req.user.storeId;
    return this.service.getStoreDetail(effectiveId, w.from, w.to, tz);
  }

  @Get('products')
  @Roles('manager')
  @ApiOperation({ summary: 'Recherche + classements produits (ventes réelles, identité réseau = EAN)' })
  products(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brand') brand?: string,
    @Query('supplierId') supplierId?: string,
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('storeId') storeId?: string,
  ) {
    const w = this.window(from, to);
    return this.service.searchProducts({
      from: w.from,
      to: w.to,
      storeId: this.scope(req, storeId),
      q,
      categoryId,
      brand,
      supplierId,
      sort,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('catalog')
  @Roles('manager')
  @ApiOperation({ summary: 'Recherche catalogue (référentiel produits, même sans vente sur la période)' })
  catalog(
    @Req() req: any,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('storeId') storeId?: string,
  ) {
    if (!q || q.trim().length < 2) {
      throw new BadRequestException('q requis (2 caractères minimum)');
    }
    return this.service.searchCatalog({
      q: q.trim(),
      storeId: this.scope(req, storeId),
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('products/:ean')
  @Roles('manager')
  @ApiOperation({ summary: 'Fiche produit agrégée par EAN (ventes, magasins, co-achats, variantes)' })
  productDetail(
    @Req() req: any,
    @Param('ean') ean: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeId') storeId?: string,
    @Query('tz') tz?: string,
  ) {
    const w = this.window(from, to);
    return this.service.getProductDetail(ean, w.from, w.to, this.scope(req, storeId), tz);
  }

  @Get('categories')
  @Roles('manager')
  @ApiOperation({ summary: 'Analyse des catégories (CA, part, progression, meilleur magasin, top produits)' })
  categories(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeId') storeId?: string,
  ) {
    const w = this.window(from, to);
    return this.service.getCategories(w.from, w.to, this.scope(req, storeId));
  }

  @Get('heatmap')
  @Roles('manager')
  @ApiOperation({ summary: 'Carte thermique jour × heure (CA + tickets)' })
  heatmap(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeId') storeId?: string,
    @Query('tz') tz?: string,
  ) {
    const w = this.window(from, to);
    return this.service.getHeatmap(w.from, w.to, this.scope(req, storeId), tz);
  }

  /** manager → toujours [son magasin] ; admin → liste demandée. */
  private scopeMany(req: any, storeIds?: string): string[] {
    if (req.user.role !== 'admin') return [req.user.storeId];
    return (storeIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  @Get('series')
  @Roles('manager')
  @ApiOperation({
    summary:
      'P367 — séries multi-magasins (bucket auto heure/jour/semaine/mois, zéro-rempli, moyenne+total réseau)',
  })
  series(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeIds') storeIds?: string,
    @Query('bucket') bucket?: string,
    @Query('tz') tz?: string,
    @Query('includeNetwork') includeNetwork?: string,
  ) {
    const w = this.window(from, to);
    return this.service.getSeries({
      from: w.from,
      to: w.to,
      storeIds: this.scopeMany(req, storeIds),
      bucket,
      tz,
      // Moyenne/total réseau réservés à l'admin (un manager ne voit pas les
      // agrégats des autres tenants, même anonymisés).
      includeNetwork:
        req.user.role === 'admin' && (includeNetwork === '1' || includeNetwork === 'true'),
    });
  }

  @Get('products-matrix')
  @Roles('manager')
  @ApiOperation({
    summary: 'P367 — matrice produits × magasins (qté, CA, prix moyen, tickets, rang par magasin, total réseau)',
  })
  productsMatrix(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeIds') storeIds?: string,
    @Query('sortStoreId') sortStoreId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const w = this.window(from, to);
    return this.service.getProductsMatrix({
      from: w.from,
      to: w.to,
      storeIds: this.scopeMany(req, storeIds),
      sortStoreId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('compare')
  @Roles('manager')
  @ApiOperation({ summary: 'Comparaison générique : période A vs B et/ou magasin A vs B / réseau' })
  compare(
    @Req() req: any,
    @Query('aFrom') aFrom?: string,
    @Query('aTo') aTo?: string,
    @Query('bFrom') bFrom?: string,
    @Query('bTo') bTo?: string,
    @Query('storeA') storeA?: string,
    @Query('storeB') storeB?: string,
    @Query('tz') tz?: string,
  ) {
    const a = this.window(aFrom, aTo);
    const b = this.window(bFrom, bTo);
    const isAdmin = req.user.role === 'admin';
    return this.service.getCompare({
      aFrom: a.from,
      aTo: a.to,
      bFrom: b.from,
      bTo: b.to,
      // Manager: les deux côtés restent verrouillés sur SON magasin.
      storeA: isAdmin ? storeA || null : req.user.storeId,
      storeB: isAdmin ? storeB || null : req.user.storeId,
      tz,
    });
  }
}
