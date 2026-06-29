import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { PosSessionEntity } from '../../database/entities/pos-session.entity';
import { TimewinService } from '../timewin/timewin.service';
import { toWorkIntervals } from '../timewin/shift-adapter';
import {
  reconcilePresence,
  WorkInterval,
  ReconcileResult,
} from '../timewin/presence-reconciliation';

export interface StoreReconciliation extends ReconcileResult {
  storeId: string;
  employeeId: string | null;
  date: string;
  posSessionCount: number;
  timewinReachable: boolean;
}

/**
 * POS ↔ TimeWin24 presence reconciliation for a store/day.
 * POS sessions come from our DB; TimeWin shifts are fetched best-effort
 * (degrades gracefully: if TW24 is unreachable, reconciliation still runs on
 * POS-only data and flags `timewin_without_pos`/`pos_without_timewin`).
 * Read-only, never blocks the caisse.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectRepository(PosSessionEntity)
    private readonly sessions: Repository<PosSessionEntity>,
    private readonly timewin: TimewinService,
  ) {}

  async reconcileToday(storeId: string, employeeId?: string): Promise<StoreReconciliation> {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const where: any = { storeId, openedAt: Between(dayStart, dayEnd) };
    if (employeeId) where.employeeId = employeeId;
    const rows = await this.sessions.find({ where });
    const posSessions: WorkInterval[] = rows.map((s) => ({
      start: s.openedAt,
      end: s.closedAt ?? null,
    }));

    let timewinShifts: WorkInterval[] = [];
    let timewinReachable = true;
    try {
      timewinShifts = toWorkIntervals(
        await this.timewin.getTodayShifts(storeId),
        employeeId ? { employeeId } : undefined,
      );
    } catch (e: any) {
      timewinReachable = false;
      this.logger.warn(`TimeWin24 today-shifts unreachable for ${storeId}: ${e?.message}`);
    }

    const result = reconcilePresence({ posSessions, timewinShifts });
    return {
      ...result,
      storeId,
      employeeId: employeeId ?? null,
      date: dayStart.toISOString().slice(0, 10),
      posSessionCount: rows.length,
      timewinReachable,
    };
  }
}
