import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { StockService } from '../stock/stock.service';
import { SaleAnomalyLogEntity } from '../../database/entities/sale-anomaly-log.entity';
import { buildAlertsCockpit, CockpitPayload } from './cockpit';

/**
 * POS-110/112 — Read-only supervision cockpit. Aggregates open stock alerts and open
 * sale anomalies for a store. Writes nothing. Tenant scoping is enforced by the caller
 * (controller passes the JWT store; admins may target another store).
 */
@Injectable()
export class MobileCockpitService {
  constructor(
    private readonly stockService: StockService,
    @InjectRepository(SaleAnomalyLogEntity)
    private readonly anomalyRepo: Repository<SaleAnomalyLogEntity>,
  ) {}

  async getAlerts(storeId: string, limit = 50): Promise<CockpitPayload> {
    const stock = await this.stockService.getAlerts(storeId);
    const anomalies = await this.anomalyRepo.find({
      where: { storeId, status: 'detected' },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return buildAlertsCockpit({
      stockAlert: stock.alert.map((p) => ({
        id: p.id,
        name: p.name,
        ean: p.ean,
        stockQuantity: p.stockQuantity,
      })),
      stockCritical: stock.critical.map((p) => ({
        id: p.id,
        name: p.name,
        ean: p.ean,
        stockQuantity: p.stockQuantity,
      })),
      anomalies: anomalies.map((a) => ({
        id: a.id,
        code: a.code,
        severity: a.severity,
        message: a.message,
        createdAt: a.createdAt,
      })),
    });
  }
}
