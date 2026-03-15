import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Jackpot configuration per store — controlled exclusively by HQ admin.
 * Local POS can only READ this config, never write.
 */
@Entity('jackpot_configs')
@Index(['storeId', 'isActive'])
export class JackpotConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  // --- Quotas (per day, set by HQ) ---
  @Column({ name: 'mega_jackpot_quota_per_day', default: 1 })
  megaJackpotQuotaPerDay: number;

  @Column({ name: 'small_win_quota_per_day', default: 3 })
  smallWinQuotaPerDay: number;

  // --- Smart-Foule thresholds ---
  /** Minimum live_count to activate mega jackpot probability */
  @Column({ name: 'density_threshold_for_mega', default: 8 })
  densityThresholdForMega: number;

  /** Mega jackpot probability in percent (e.g. 5 = 5%) */
  @Column({
    name: 'mega_probability_percent',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 5,
  })
  megaProbabilityPercent: number;

  /** Small win probability in percent */
  @Column({
    name: 'small_win_probability_percent',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 15,
  })
  smallWinProbabilityPercent: number;

  // --- Media assets (URLs or local paths) ---
  @Column({ name: 'roulette_video_url', nullable: true })
  rouletteVideoUrl: string;

  @Column({ name: 'win_video_url', nullable: true })
  winVideoUrl: string;

  @Column({ name: 'thanks_video_url', nullable: true })
  thanksVideoUrl: string;

  @Column({ name: 'win_audio_url', nullable: true })
  winAudioUrl: string;

  @Column({ name: 'thanks_audio_url', nullable: true })
  thanksAudioUrl: string;

  // --- Weather integration ---
  @Column({ name: 'open_weather_api_key', nullable: true })
  openWeatherApiKey: string;

  @Column({ name: 'open_weather_city', nullable: true })
  openWeatherCity: string;

  // --- State ---
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
