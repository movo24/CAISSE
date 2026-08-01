import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { AiRecommendationLogEntity } from '../../database/entities/ai-recommendation-log.entity';
import {
  rate,
  scoreRecommendation,
  BLACKLIST_MIN_DISPLAYS,
  BLACKLIST_CTR_THRESHOLD,
  PENALTY_CTR_THRESHOLD,
} from './reco-scoring';

/* ═══════════════════════════════════════════════════════════════
   AI LEARNING SERVICE — Track, measure, and improve recommendations

   Tracks: displayed → clicked → added_to_cart → converted
   Learns: boost products that convert, penalize products that don't
   Adapts: per-employee performance tracking
   ═══════════════════════════════════════════════════════════════ */

export interface RecoPerformance {
  suggestedProductId: string;
  suggestedProductName: string;
  totalDisplayed: number;
  totalClicked: number;
  totalConverted: number;
  ctr: number;              // click-through rate (0-1)
  conversionRate: number;   // conversion rate (0-1)
  totalRevenueGenerated: number;
  totalMarginGenerated: number;
  performanceScore: number; // 0-1 (learned quality score)
  status: 'active' | 'penalized' | 'blacklisted';
}

export interface AiKPI {
  totalRecos: number;
  totalClicked: number;
  totalConverted: number;
  globalCTR: number;
  globalConversion: number;
  totalRevenue: number;
  totalMargin: number;
  avgRevenuePerReco: number;
  avgMarginPerReco: number;
  topPerformers: RecoPerformance[];
  worstPerformers: RecoPerformance[];
}

// Scoring thresholds live in reco-scoring.ts (pure, unit-tested).

@Injectable()
export class AiLearningService {
  private readonly logger = new Logger('AiLearning');

  constructor(
    @InjectRepository(AiRecommendationLogEntity)
    private readonly logRepo: Repository<AiRecommendationLogEntity>,
  ) {}

  // ── LOG a recommendation display ──
  async logDisplay(data: {
    storeId: string;
    employeeId?: string;
    triggerProductId: string;
    triggerProductName: string;
    suggestedProductId: string;
    suggestedProductName: string;
    confidence: number;
    estimatedCashImpact: number;
    marginPercent: number;
  }): Promise<string> {
    const log = await this.logRepo.save({
      ...data,
      employeeId: data.employeeId || null,
      displayed: true,
      clicked: false,
      addedToCart: false,
      converted: false,
      revenueGenerated: 0,
      marginGenerated: 0,
    });
    return log.id;
  }

  // ── Track click ──
  async logClick(logId: string): Promise<void> {
    await this.logRepo.update(logId, { clicked: true });
  }

  // ── Track add to cart ──
  async logAddToCart(logId: string): Promise<void> {
    await this.logRepo.update(logId, { addedToCart: true });
  }

  // ── Track conversion (sale completed with recommended product) ──
  async logConversion(logId: string, saleId: string, revenueGenerated: number, marginGenerated: number): Promise<void> {
    await this.logRepo.update(logId, {
      converted: true,
      saleId,
      revenueGenerated,
      marginGenerated,
    });
  }

  // ── Get performance score for a product (used to adjust future recommendations) ──
  async getProductPerformance(suggestedProductId: string, storeId: string, daysBack = 30): Promise<RecoPerformance> {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const logs = await this.logRepo.find({
      where: {
        suggestedProductId,
        storeId,
        createdAt: MoreThan(since),
      },
    });

    const totalDisplayed = logs.filter((l) => l.displayed).length;
    const totalClicked = logs.filter((l) => l.clicked).length;
    const totalConverted = logs.filter((l) => l.converted).length;
    const totalRevenue = logs.reduce((s, l) => s + l.revenueGenerated, 0);
    const totalMargin = logs.reduce((s, l) => s + l.marginGenerated, 0);

    const ctr = rate(totalClicked, totalDisplayed);
    const conversionRate = rate(totalConverted, totalDisplayed);

    // Performance scoring (pure helper — see reco-scoring.ts)
    const { performanceScore, status } = scoreRecommendation(
      totalDisplayed,
      ctr,
      conversionRate,
    );

    return {
      suggestedProductId,
      suggestedProductName: logs[0]?.suggestedProductName || suggestedProductId,
      totalDisplayed,
      totalClicked,
      totalConverted,
      ctr,
      conversionRate,
      totalRevenueGenerated: totalRevenue,
      totalMarginGenerated: totalMargin,
      performanceScore,
      status,
    };
  }

  // ── Get global AI KPI ──
  async getKPI(storeId: string, daysBack = 30): Promise<AiKPI> {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const logs = await this.logRepo.find({
      where: { storeId, createdAt: MoreThan(since) },
    });

    const totalRecos = logs.length;
    const totalClicked = logs.filter((l) => l.clicked).length;
    const totalConverted = logs.filter((l) => l.converted).length;
    const totalRevenue = logs.reduce((s, l) => s + l.revenueGenerated, 0);
    const totalMargin = logs.reduce((s, l) => s + l.marginGenerated, 0);

    // Group by suggested product
    const byProduct = new Map<string, typeof logs>();
    for (const log of logs) {
      const key = log.suggestedProductId;
      if (!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key)!.push(log);
    }

    const performances: RecoPerformance[] = [];
    for (const [pid, productLogs] of byProduct) {
      const displayed = productLogs.length;
      const clicked = productLogs.filter((l) => l.clicked).length;
      const converted = productLogs.filter((l) => l.converted).length;
      const rev = productLogs.reduce((s, l) => s + l.revenueGenerated, 0);
      const margin = productLogs.reduce((s, l) => s + l.marginGenerated, 0);
      const ctr = rate(clicked, displayed);
      const convRate = rate(converted, displayed);

      performances.push({
        suggestedProductId: pid,
        suggestedProductName: productLogs[0]?.suggestedProductName || pid,
        totalDisplayed: displayed,
        totalClicked: clicked,
        totalConverted: converted,
        ctr,
        conversionRate: convRate,
        totalRevenueGenerated: rev,
        totalMarginGenerated: margin,
        performanceScore: Math.min(1, ctr * 5 + convRate * 3),
        status: displayed >= BLACKLIST_MIN_DISPLAYS && ctr < BLACKLIST_CTR_THRESHOLD ? 'blacklisted'
          : displayed >= BLACKLIST_MIN_DISPLAYS && ctr < PENALTY_CTR_THRESHOLD ? 'penalized' : 'active',
      });
    }

    performances.sort((a, b) => b.totalMarginGenerated - a.totalMarginGenerated);

    return {
      totalRecos,
      totalClicked,
      totalConverted,
      globalCTR: totalRecos > 0 ? totalClicked / totalRecos : 0,
      globalConversion: totalRecos > 0 ? totalConverted / totalRecos : 0,
      totalRevenue,
      totalMargin,
      avgRevenuePerReco: totalConverted > 0 ? Math.round(totalRevenue / totalConverted) : 0,
      avgMarginPerReco: totalConverted > 0 ? Math.round(totalMargin / totalConverted) : 0,
      topPerformers: performances.filter((p) => p.status === 'active').slice(0, 5),
      worstPerformers: performances.filter((p) => p.status !== 'active').slice(0, 5),
    };
  }

  // ── Check if a product is blacklisted ──
  async isBlacklisted(suggestedProductId: string, storeId: string): Promise<boolean> {
    const perf = await this.getProductPerformance(suggestedProductId, storeId);
    return perf.status === 'blacklisted';
  }
}
