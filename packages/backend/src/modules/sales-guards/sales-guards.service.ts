import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';

import { SaleAnomalyLogEntity } from '../../database/entities/sale-anomaly-log.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { SalesGuardsConfigProvider } from './sales-guards.config';
import { evaluateSaleGuards } from './sales-guards.engine';
import {
  AnomalyStatus,
  GuardCartItem,
  RawGuardCartItem,
  SaleGuardResult,
  SaleGuardsConfig,
} from './sales-guards.types';
import { ListAnomaliesDto } from './dto/list-anomalies.dto';

export interface EvaluateParams {
  storeId: string;
  sellerId: string;
  items: RawGuardCartItem[];
  saleId?: string;
  freeProductUsageCount?: number;
  cancellationCount?: number;
}

export interface EvaluateResponse {
  results: SaleGuardResult[];
  anomalyIds: string[];
  /** Aggregate: does the cart require a manager code before payment? */
  requiresManagerApproval: boolean;
  /** Aggregate: is there a blocking critical anomaly? */
  hasBlocking: boolean;
}

export interface AnomaliesPage {
  data: SaleAnomalyLogEntity[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class SalesGuardsService {
  private readonly logger = new Logger(SalesGuardsService.name);

  constructor(
    @InjectRepository(SaleAnomalyLogEntity)
    private readonly anomalyRepo: Repository<SaleAnomalyLogEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    private readonly configProvider: SalesGuardsConfigProvider,
  ) {}

  /**
   * Fills missing cost/catalogue from the product table (cost stays server-side).
   * Derives `manualPriceOverride` when the charged price differs from catalogue.
   */
  private async enrichItems(
    storeId: string,
    raw: RawGuardCartItem[],
  ): Promise<GuardCartItem[]> {
    const needsLookup = raw.some(
      (i) => i.costMinorUnits === undefined || i.catalogPriceMinorUnits === undefined,
    );

    let byId = new Map<string, ProductEntity>();
    let byEan = new Map<string, ProductEntity>();

    if (needsLookup) {
      const ids = raw.map((i) => i.productId).filter(Boolean);
      const eans = raw.map((i) => i.ean).filter((e): e is string => !!e);
      if (ids.length || eans.length) {
        const products = await this.productRepo
          .createQueryBuilder('p')
          .where('p.store_id = :storeId', { storeId })
          .andWhere(
            new Brackets((b) => {
              if (ids.length) b.orWhere('p.id IN (:...ids)', { ids });
              if (eans.length) b.orWhere('p.ean IN (:...eans)', { eans });
            }),
          )
          .getMany();
        byId = new Map(products.map((p) => [p.id, p]));
        byEan = new Map(products.map((p) => [p.ean, p]));
      }
    }

    return raw.map((i) => {
      const p = byId.get(i.productId) ?? (i.ean ? byEan.get(i.ean) : undefined);
      const catalog =
        i.catalogPriceMinorUnits ?? p?.priceMinorUnits ?? i.sellPriceMinorUnits ?? 0;
      const cost =
        i.costMinorUnits !== undefined
          ? i.costMinorUnits
          : p
            ? (p.costMinorUnits ?? null)
            : null;
      const sell = i.sellPriceMinorUnits ?? catalog;
      const manualPriceOverride = i.manualPriceOverride ?? sell !== catalog;

      return {
        productId: i.productId,
        productName: i.productName ?? p?.name,
        quantity: i.quantity,
        sellPriceMinorUnits: sell,
        catalogPriceMinorUnits: catalog,
        costMinorUnits: cost,
        discountMinorUnits: i.discountMinorUnits,
        manualPriceOverride,
        isFreeProduct: i.isFreeProduct,
        recentPriceChange: i.recentPriceChange,
      };
    });
  }

  getConfig(): SaleGuardsConfig {
    return this.configProvider.get();
  }

  /**
   * Run the pure guard engine, persist the non-info anomalies, and return both
   * the results and the aggregate escalation flags.
   * READ-ONLY w.r.t. sales/tickets — only writes to sale_anomaly_logs.
   */
  async evaluate(params: EvaluateParams): Promise<EvaluateResponse> {
    const items = await this.enrichItems(params.storeId, params.items);
    const results = evaluateSaleGuards({
      storeId: params.storeId,
      sellerId: params.sellerId,
      items,
      freeProductUsageCount: params.freeProductUsageCount,
      cancellationCount: params.cancellationCount,
      config: this.configProvider.get(),
    });

    const toPersist = results.filter((r) => r.severity !== 'info');
    const anomalyIds: string[] = [];

    for (const r of toPersist) {
      try {
        const row = this.anomalyRepo.create({
          storeId: params.storeId,
          sellerId: params.sellerId,
          saleId: params.saleId ?? null,
          productId: r.productId ?? null,
          code: r.code,
          severity: r.severity,
          blocking: r.blocking,
          managerApprovalRequired: r.managerApprovalRequired,
          message: r.message,
          metadata: r.metadata ?? null,
          status: 'detected',
        });
        const saved = await this.anomalyRepo.save(row);
        anomalyIds.push(saved.id);
      } catch (err: any) {
        // Logging must never break the cart evaluation
        this.logger.error(`Failed to persist anomaly ${r.code}: ${err?.message}`);
      }
    }

    return {
      results,
      anomalyIds,
      requiresManagerApproval: results.some((r) => r.managerApprovalRequired),
      hasBlocking: results.some((r) => r.blocking),
    };
  }

  async listAnomalies(dto: ListAnomaliesDto): Promise<AnomaliesPage> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;

    const qb = this.anomalyRepo.createQueryBuilder('a');
    if (dto.storeId) qb.andWhere('a.store_id = :storeId', { storeId: dto.storeId });
    if (dto.sellerId) qb.andWhere('a.seller_id = :sellerId', { sellerId: dto.sellerId });
    if (dto.code) qb.andWhere('a.code = :code', { code: dto.code });
    if (dto.status) qb.andWhere('a.status = :status', { status: dto.status });
    if (dto.severity) qb.andWhere('a.severity = :severity', { severity: dto.severity });
    if (dto.from) {
      const d = new Date(dto.from);
      if (!Number.isNaN(d.getTime())) {
        qb.andWhere('a.created_at >= :from', { from: d });
      }
    }

    qb.orderBy('a.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  /** Summary counts by code, for the backoffice dashboard (optionally per store/day). */
  async getSummary(
    storeId?: string,
    from?: string,
  ): Promise<{ byCode: Record<string, number>; bySeverity: Record<string, number>; total: number }> {
    const qb = this.anomalyRepo.createQueryBuilder('a');
    if (storeId) qb.andWhere('a.store_id = :storeId', { storeId });
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) qb.andWhere('a.created_at >= :from', { from: d });
    }

    const rows = await qb
      .select('a.code', 'code')
      .addSelect('a.severity', 'severity')
      .addSelect('COUNT(*)', 'count')
      .groupBy('a.code')
      .addGroupBy('a.severity')
      .getRawMany<{ code: string; severity: string; count: string }>();

    const byCode: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const c = parseInt(r.count, 10);
      byCode[r.code] = (byCode[r.code] ?? 0) + c;
      bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + c;
      total += c;
    }
    return { byCode, bySeverity, total };
  }

  async approveAnomaly(id: string, reviewerId: string): Promise<SaleAnomalyLogEntity> {
    return this.transition(id, reviewerId, 'approved');
  }

  async ignoreAnomaly(id: string, reviewerId: string): Promise<SaleAnomalyLogEntity> {
    return this.transition(id, reviewerId, 'ignored');
  }

  private async transition(
    id: string,
    reviewerId: string,
    next: AnomalyStatus,
  ): Promise<SaleAnomalyLogEntity> {
    const anomaly = await this.anomalyRepo.findOne({ where: { id } });
    if (!anomaly) throw new NotFoundException(`Anomaly ${id} not found`);
    if (anomaly.status !== 'detected') {
      throw new BadRequestException(
        `Anomaly ${id} is '${anomaly.status}', only 'detected' can transition`,
      );
    }
    anomaly.status = next;
    anomaly.reviewedBy = reviewerId;
    anomaly.reviewedAt = new Date();
    return this.anomalyRepo.save(anomaly);
  }
}
