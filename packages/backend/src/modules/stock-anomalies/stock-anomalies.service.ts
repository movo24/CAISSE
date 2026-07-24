import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StockAnomalyEntity } from '../../database/entities/stock-anomaly.entity';

/**
 * Anomalies de stock — « vente autorisée malgré indisponibilité » (chantier 4).
 *
 * Lecture seule + clôture contrôlée : les anomalies sont CRÉÉES exclusivement
 * par SalesService.createSale, dans la même transaction que la vente. Ici on
 * les liste (responsable magasin + Central) et on les marque « contrôlée »
 * avec justification obligatoire. Une anomalie n'est JAMAIS supprimée : c'est
 * un fait historique qui reste traçable après régularisation du stock.
 */
@Injectable()
export class StockAnomaliesService {
  private readonly logger = new Logger(StockAnomaliesService.name);

  constructor(
    @InjectRepository(StockAnomalyEntity)
    private readonly anomalyRepo: Repository<StockAnomalyEntity>,
  ) {}

  /** Liste paginée, plus récentes d'abord. `status` optionnel pour filtrer. */
  async list(
    storeId: string,
    opts: { status?: 'a_controler' | 'controlee'; limit?: number; offset?: number } = {},
  ): Promise<{ items: StockAnomalyEntity[]; total: number; pendingCount: number }> {
    const where: Record<string, unknown> = { storeId };
    if (opts.status) where.status = opts.status;

    const [items, total] = await this.anomalyRepo.findAndCount({
      where: where as any,
      order: { occurredAt: 'DESC' },
      take: Math.min(opts.limit ?? 50, 200),
      skip: opts.offset ?? 0,
    });
    const pendingCount = await this.anomalyRepo.count({
      where: { storeId, status: 'a_controler' },
    });
    return { items, total, pendingCount };
  }

  /** Nombre d'anomalies « À contrôler » (badge centre de notifications). */
  async countPending(storeId: string): Promise<number> {
    return this.anomalyRepo.count({ where: { storeId, status: 'a_controler' } });
  }

  /**
   * Marque une anomalie « contrôlée » — responsable/admin, justification
   * obligatoire. Idempotent-conservateur : une anomalie déjà contrôlée n'est
   * pas re-contrôlable silencieusement (l'historique du premier contrôle
   * reste intact).
   */
  async markControlled(
    id: string,
    storeId: string,
    employeeId: string,
    employeeName: string | null,
    justification: string,
  ): Promise<StockAnomalyEntity> {
    const trimmed = (justification ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('Une justification est obligatoire pour contrôler une anomalie de stock.');
    }
    const anomaly = await this.anomalyRepo.findOne({ where: { id, storeId } });
    if (!anomaly) {
      throw new NotFoundException(`Anomalie de stock introuvable: ${id}`);
    }
    if (anomaly.status === 'controlee') {
      throw new BadRequestException(
        `Anomalie déjà contrôlée le ${anomaly.controlledAt?.toISOString() ?? '?'} par ${anomaly.controlledByName ?? anomaly.controlledBy ?? '?'}.`,
      );
    }

    anomaly.status = 'controlee';
    anomaly.controlledBy = employeeId;
    anomaly.controlledByName = employeeName;
    anomaly.controlledAt = new Date();
    anomaly.justification = trimmed;
    const saved = await this.anomalyRepo.save(anomaly);
    this.logger.log(
      `Stock anomaly ${id} (vente ${anomaly.ticketNumber}, magasin ${storeId}) contrôlée par ${employeeName ?? employeeId}`,
    );
    return saved;
  }
}
