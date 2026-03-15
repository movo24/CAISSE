import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreEntity } from '../../database/entities/store.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { ClaudeService } from '../ia/claude.service';
import {
  NetworkSnapshotDto,
  StorePerformanceDto,
  CompactComparisonDto,
  InactiveAlertDto,
} from './dto/live-performance.dto';

const INACTIVE_THRESHOLD_MINUTES = 30;

@Injectable()
export class LivePerformanceService {
  private readonly logger = new Logger(LivePerformanceService.name);

  constructor(
    @InjectRepository(StoreEntity)
    private readonly storeRepo: Repository<StoreEntity>,
    @InjectRepository(SaleEntity)
    private readonly saleRepo: Repository<SaleEntity>,
    @InjectRepository(SaleLineItemEntity)
    private readonly lineItemRepo: Repository<SaleLineItemEntity>,
    private readonly claudeService: ClaudeService,
  ) {}

  async getNetworkSnapshot(callerStoreId: string): Promise<NetworkSnapshotDto> {
    const callerStore = await this.storeRepo.findOne({ where: { id: callerStoreId } });
    if (!callerStore) throw new NotFoundException('Store not found');

    const networkId = callerStore.networkId;
    if (!networkId) {
      return {
        networkId: 'none',
        stores: [await this.buildStorePerformance(callerStore, 1)],
        totalNetworkRevenue: 0,
        generatedAt: new Date().toISOString(),
      };
    }

    const networkStores = await this.storeRepo.find({
      where: { networkId, isActive: true },
    });

    const storePerformances: StorePerformanceDto[] = [];
    for (const store of networkStores) {
      storePerformances.push(await this.buildStorePerformance(store, 0));
    }

    // Sort by revenue descending and assign ranks
    storePerformances.sort((a, b) => b.todayRevenue - a.todayRevenue);
    storePerformances.forEach((s, i) => (s.rank = i + 1));

    const totalNetworkRevenue = storePerformances.reduce((sum, s) => sum + s.todayRevenue, 0);

    return {
      networkId,
      stores: storePerformances,
      totalNetworkRevenue,
      generatedAt: new Date().toISOString(),
    };
  }

  async getCompactComparison(callerStoreId: string): Promise<CompactComparisonDto> {
    const snapshot = await this.getNetworkSnapshot(callerStoreId);
    const myStore = snapshot.stores.find((s) => s.storeId === callerStoreId);
    const leader = snapshot.stores[0];

    const inactiveAlerts: InactiveAlertDto[] = snapshot.stores
      .filter((s) => s.isInactive && s.lastSaleAt)
      .map((s) => ({
        storeName: s.storeName,
        minutesSinceLastSale: Math.round(
          (Date.now() - new Date(s.lastSaleAt!).getTime()) / 60000,
        ),
      }));

    const myRevenue = myStore?.todayRevenue ?? 0;
    const leaderRevenue = leader?.todayRevenue ?? 0;
    const deltaPercent =
      leaderRevenue > 0
        ? Math.round(((leaderRevenue - myRevenue) / leaderRevenue) * 100)
        : 0;

    return {
      myRank: myStore?.rank ?? 0,
      totalStores: snapshot.stores.length,
      myRevenue,
      leaderRevenue,
      deltaPercent,
      myStoreName: myStore?.storeName ?? '',
      leaderStoreName: leader?.storeName ?? '',
      inactiveAlerts,
    };
  }

  async getAiInsight(callerStoreId: string): Promise<{ insight: string }> {
    if (!this.claudeService.isAvailable()) {
      return { insight: 'Service IA non disponible. Configurez ANTHROPIC_API_KEY.' };
    }

    const snapshot = await this.getNetworkSnapshot(callerStoreId);

    const storesData = snapshot.stores
      .map(
        (s) =>
          `- ${s.storeName} (rang ${s.rank}): CA ${(s.todayRevenue / 100).toFixed(2)}€, ` +
          `${s.todayTransactions} tx, panier moyen ${(s.avgBasket / 100).toFixed(2)}€, ` +
          `CA/h ${(s.currentHourRevenue / 100).toFixed(2)}€` +
          (s.isInactive ? ' [INACTIF]' : '') +
          (s.topProducts.length > 0
            ? `, top: ${s.topProducts.map((p) => `${p.name}(${p.quantity})`).join(', ')}`
            : ''),
      )
      .join('\n');

    const systemPrompt = `Tu es un coach commercial positif pour le réseau de magasins "${snapshot.networkId}".

DONNÉES RÉSEAU (aujourd'hui):
CA total réseau: ${(snapshot.totalNetworkRevenue / 100).toFixed(2)}€
${storesData}

RÈGLES:
1. Réponds TOUJOURS en français
2. Ton POSITIF et motivant — pas de jugement
3. Donne 2-3 recommandations COURTES et ACTIONNABLES
4. Si un magasin est inactif, suggère une action constructive
5. Mets en valeur les points forts du réseau
6. Maximum 150 mots
7. Structure en Markdown (## titres, **gras**, - listes)`;

    try {
      const result = await this.claudeService.chat(systemPrompt, [
        { role: 'user', content: 'Analyse la performance réseau et donne tes recommandations.' },
      ]);
      return { insight: result.text };
    } catch (err: any) {
      this.logger.error(`AI insight failed: ${err.message}`);
      return { insight: 'Impossible de générer les suggestions IA pour le moment.' };
    }
  }

  private async buildStorePerformance(
    store: StoreEntity,
    defaultRank: number,
  ): Promise<StorePerformanceDto> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const currentHour = new Date();
    currentHour.setMinutes(0, 0, 0);

    // Today's sales summary
    const todayStats = await this.saleRepo
      .createQueryBuilder('s')
      .select('COALESCE(SUM(s.total_minor_units), 0)', 'revenue')
      .addSelect('COUNT(*)::int', 'txCount')
      .addSelect('MAX(s.completed_at)', 'lastSaleAt')
      .where('s.store_id = :storeId', { storeId: store.id })
      .andWhere('s.status = :status', { status: 'completed' })
      .andWhere('s.completed_at >= :today', { today: today.toISOString() })
      .getRawOne();

    // Current hour revenue
    const hourStats = await this.saleRepo
      .createQueryBuilder('s')
      .select('COALESCE(SUM(s.total_minor_units), 0)', 'revenue')
      .addSelect('COUNT(*)::int', 'txCount')
      .where('s.store_id = :storeId', { storeId: store.id })
      .andWhere('s.status = :status', { status: 'completed' })
      .andWhere('s.completed_at >= :hour', { hour: currentHour.toISOString() })
      .getRawOne();

    // Top 3 products today
    const topProducts = await this.lineItemRepo
      .createQueryBuilder('li')
      .select('li.product_name', 'name')
      .addSelect('SUM(li.quantity)::int', 'quantity')
      .innerJoin('li.sale', 's')
      .where('s.store_id = :storeId', { storeId: store.id })
      .andWhere('s.status = :status', { status: 'completed' })
      .andWhere('s.completed_at >= :today', { today: today.toISOString() })
      .groupBy('li.product_name')
      .orderBy('"quantity"', 'DESC')
      .limit(3)
      .getRawMany();

    const revenue = Number(todayStats?.revenue ?? 0);
    const txCount = Number(todayStats?.txCount ?? 0);
    const lastSaleAt = todayStats?.lastSaleAt ?? null;

    const isInactive =
      lastSaleAt != null
        ? (Date.now() - new Date(lastSaleAt).getTime()) / 60000 > INACTIVE_THRESHOLD_MINUTES
        : true;

    return {
      storeId: store.id,
      storeName: store.name,
      rank: defaultRank,
      todayRevenue: revenue,
      todayTransactions: txCount,
      avgBasket: txCount > 0 ? Math.round(revenue / txCount) : 0,
      currentHourRevenue: Number(hourStats?.revenue ?? 0),
      currentHourTransactions: Number(hourStats?.txCount ?? 0),
      lastSaleAt: lastSaleAt ? new Date(lastSaleAt).toISOString() : null,
      isInactive,
      topProducts: topProducts.map((p) => ({ name: p.name, quantity: Number(p.quantity) })),
    };
  }
}
