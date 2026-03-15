import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { StaffingSnapshotEntity } from '../../database/entities/staffing-snapshot.entity';

@Injectable()
export class StaffingService {
  constructor(
    @InjectRepository(StaffingSnapshotEntity)
    private readonly repo: Repository<StaffingSnapshotEntity>,
  ) {}

  // ── Submit a staffing snapshot (from POS every 5 min) ──
  async submitSnapshot(storeId: string, data: any): Promise<StaffingSnapshotEntity> {
    const snapshot = this.repo.create({
      storeId,
      level: data.level || 'unknown',
      activeCashiersCount: data.activeCashiers?.length || 0,
      currentHourTx: data.currentHourTx || 0,
      currentHourRevenue: data.currentHourRevenue || 0,
      activeCashiers: data.activeCashiers || [],
      hourlySnapshots: data.hourlySnapshots || [],
      lastRecommendation: data.lastRecommendation || null,
    });
    return this.repo.save(snapshot);
  }

  // ── Get hourly targets for a store ──
  async getTargets(storeId: string): Promise<any[]> {
    // Default targets based on typical retail patterns
    // In production, these would be configurable per store
    const defaults: any[] = [];
    const hourlyConfig: Record<number, { revenue: number; capacity: number }> = {
      8: { revenue: 50000, capacity: 15 },
      9: { revenue: 80000, capacity: 25 },
      10: { revenue: 120000, capacity: 35 },
      11: { revenue: 150000, capacity: 40 },
      12: { revenue: 180000, capacity: 45 },
      13: { revenue: 140000, capacity: 35 },
      14: { revenue: 160000, capacity: 40 },
      15: { revenue: 170000, capacity: 42 },
      16: { revenue: 180000, capacity: 45 },
      17: { revenue: 200000, capacity: 50 },
      18: { revenue: 160000, capacity: 40 },
      19: { revenue: 100000, capacity: 30 },
      20: { revenue: 60000, capacity: 20 },
    };

    for (let h = 8; h <= 20; h++) {
      const cfg = hourlyConfig[h] || { revenue: 50000, capacity: 15 };
      defaults.push({
        hour: h,
        revenueTarget: cfg.revenue,
        txCapacity: cfg.capacity,
      });
    }

    return defaults;
  }

  // ── Get staffing history for a store ──
  async getHistory(storeId: string, date?: string): Promise<StaffingSnapshotEntity[]> {
    const qb = this.repo.createQueryBuilder('s')
      .where('s.store_id = :storeId', { storeId })
      .orderBy('s.created_at', 'DESC')
      .limit(100);

    if (date) {
      const day = new Date(date);
      day.setHours(0, 0, 0, 0);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      qb.andWhere('s.created_at >= :start AND s.created_at < :end', { start: day, end: next });
    }

    return qb.getMany();
  }
}
