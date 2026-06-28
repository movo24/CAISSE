import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { JackpotConfigEntity } from '../../database/entities/jackpot-config.entity';
import { JackpotWinEntity } from '../../database/entities/jackpot-win.entity';
import { OccupancyService } from '../occupancy/occupancy.service';
import { decideJackpotOutcome } from './jackpot-decision';

export type JackpotResultType = 'mega_jackpot' | 'small_win' | 'no_win';

export interface JackpotResult {
  type: JackpotResultType;
  liveCountAtRoll: number;
  config: {
    rouletteVideoUrl: string | null;
    winVideoUrl: string | null;
    thanksVideoUrl: string | null;
    winAudioUrl: string | null;
    thanksAudioUrl: string | null;
  };
}

export interface JackpotStatus {
  isActive: boolean;
  megaJackpotQuotaRemaining: number;
  smallWinQuotaRemaining: number;
  megaWonToday: number;
  smallWonToday: number;
  currentLiveCount: number;
  densityThresholdForMega: number;
  megaEligible: boolean;
}

@Injectable()
export class JackpotService {
  private readonly logger = new Logger(JackpotService.name);

  constructor(
    @InjectRepository(JackpotConfigEntity)
    private readonly configRepo: Repository<JackpotConfigEntity>,
    @InjectRepository(JackpotWinEntity)
    private readonly winRepo: Repository<JackpotWinEntity>,
    private readonly occupancyService: OccupancyService,
  ) {}

  // -----------------------------------------------------------------------
  // Config CRUD (admin only)
  // -----------------------------------------------------------------------

  async getConfig(storeId: string): Promise<JackpotConfigEntity | null> {
    return this.configRepo.findOne({ where: { storeId, isActive: true } });
  }

  async getConfigOrFail(storeId: string): Promise<JackpotConfigEntity> {
    const config = await this.getConfig(storeId);
    if (!config) {
      throw new NotFoundException(
        `No jackpot config found for store ${storeId}`,
      );
    }
    return config;
  }

  async createConfig(
    storeId: string,
    data: Partial<JackpotConfigEntity>,
  ): Promise<JackpotConfigEntity> {
    const existing = await this.getConfig(storeId);
    if (existing) {
      throw new ForbiddenException(
        'Config already exists. Use update instead.',
      );
    }
    const config = this.configRepo.create({ ...data, storeId });
    return this.configRepo.save(config);
  }

  async updateConfig(
    storeId: string,
    data: Partial<JackpotConfigEntity>,
  ): Promise<JackpotConfigEntity> {
    const config = await this.getConfigOrFail(storeId);
    // Prevent changing storeId
    delete (data as any).storeId;
    delete (data as any).id;
    Object.assign(config, data);
    return this.configRepo.save(config);
  }

  // -----------------------------------------------------------------------
  // Daily quota tracking
  // -----------------------------------------------------------------------

  private getTodayRange(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  async getUsageToday(
    storeId: string,
  ): Promise<{ megaWon: number; smallWon: number }> {
    const { start, end } = this.getTodayRange();

    const [megaWon, smallWon] = await Promise.all([
      this.winRepo.count({
        where: {
          storeId,
          type: 'mega_jackpot',
          createdAt: Between(start, end),
        },
      }),
      this.winRepo.count({
        where: {
          storeId,
          type: 'small_win',
          createdAt: Between(start, end),
        },
      }),
    ]);

    return { megaWon, smallWon };
  }

  // -----------------------------------------------------------------------
  // Status endpoint (for POS dashboard)
  // -----------------------------------------------------------------------

  async getStatus(storeId: string): Promise<JackpotStatus> {
    const config = await this.getConfig(storeId);
    if (!config) {
      return {
        isActive: false,
        megaJackpotQuotaRemaining: 0,
        smallWinQuotaRemaining: 0,
        megaWonToday: 0,
        smallWonToday: 0,
        currentLiveCount: 0,
        densityThresholdForMega: 0,
        megaEligible: false,
      };
    }

    const usage = await this.getUsageToday(storeId);
    const liveCount = this.occupancyService.getLiveCount(storeId);

    const megaRemaining = Math.max(
      0,
      config.megaJackpotQuotaPerDay - usage.megaWon,
    );
    const smallRemaining = Math.max(
      0,
      config.smallWinQuotaPerDay - usage.smallWon,
    );

    return {
      isActive: config.isActive,
      megaJackpotQuotaRemaining: megaRemaining,
      smallWinQuotaRemaining: smallRemaining,
      megaWonToday: usage.megaWon,
      smallWonToday: usage.smallWon,
      currentLiveCount: liveCount,
      densityThresholdForMega: config.densityThresholdForMega,
      megaEligible: liveCount >= config.densityThresholdForMega && megaRemaining > 0,
    };
  }

  // -----------------------------------------------------------------------
  // THE ALGORITHM — Smart-Foule Lottery Roll
  // -----------------------------------------------------------------------

  /**
   * Executes the lottery roll for a completed sale.
   *
   * Decision tree:
   * 1. If config inactive or missing → no_win
   * 2. MEGA JACKPOT:
   *    - live_count < densityThreshold → blocked (prob = 0%)
   *    - daily mega quota exhausted → blocked
   *    - Otherwise: random < megaProbabilityPercent → MEGA WIN
   * 3. SMALL WIN:
   *    - daily small quota exhausted → blocked
   *    - Otherwise: random < smallWinProbabilityPercent → SMALL WIN
   * 4. DEFAULT: no_win
   *
   * The goal: maximize marketing impact by triggering wins during peak traffic.
   */
  async rollLottery(storeId: string, saleId: string): Promise<JackpotResult> {
    const config = await this.getConfig(storeId);
    const liveCount = this.occupancyService.getLiveCount(storeId);

    // Default result (no config or inactive)
    const noWinResult: JackpotResult = {
      type: 'no_win',
      liveCountAtRoll: liveCount,
      config: {
        rouletteVideoUrl: config?.rouletteVideoUrl || null,
        winVideoUrl: config?.winVideoUrl || null,
        thanksVideoUrl: config?.thanksVideoUrl || null,
        winAudioUrl: config?.winAudioUrl || null,
        thanksAudioUrl: config?.thanksAudioUrl || null,
      },
    };

    if (!config || !config.isActive) {
      await this.recordWin(storeId, saleId, 'no_win', liveCount);
      return noWinResult;
    }

    const usage = await this.getUsageToday(storeId);

    // Decision tree extracted to a pure, unit-tested function (rolls injected here).
    const outcome = decideJackpotOutcome({
      active: config.isActive,
      liveCount,
      densityThresholdForMega: config.densityThresholdForMega,
      megaQuotaPerDay: config.megaJackpotQuotaPerDay,
      megaWonToday: usage.megaWon,
      megaProbabilityPercent: Number(config.megaProbabilityPercent),
      smallWinQuotaPerDay: config.smallWinQuotaPerDay,
      smallWonToday: usage.smallWon,
      smallWinProbabilityPercent: Number(config.smallWinProbabilityPercent),
      megaRoll: Math.random() * 100,
      smallRoll: Math.random() * 100,
    });

    if (outcome === 'mega_jackpot') {
      this.logger.warn(`MEGA JACKPOT! store=${storeId} sale=${saleId} liveCount=${liveCount}`);
    } else if (outcome === 'small_win') {
      this.logger.log(`Small win: store=${storeId} sale=${saleId} liveCount=${liveCount}`);
    }

    await this.recordWin(storeId, saleId, outcome, liveCount);
    return { type: outcome, liveCountAtRoll: liveCount, config: noWinResult.config };
  }

  // -----------------------------------------------------------------------
  // Record win
  // -----------------------------------------------------------------------

  private async recordWin(
    storeId: string,
    saleId: string,
    type: JackpotResultType,
    liveCount: number,
  ): Promise<void> {
    const win = this.winRepo.create({
      storeId,
      saleId,
      type,
      liveCountAtRoll: liveCount,
    });
    await this.winRepo.save(win);
  }

  // -----------------------------------------------------------------------
  // Win history
  // -----------------------------------------------------------------------

  async getWinHistory(
    storeId: string,
    limit = 50,
  ): Promise<JackpotWinEntity[]> {
    return this.winRepo.find({
      where: { storeId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
