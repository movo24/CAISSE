import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * STORE HOLIDAY CLOSURES — the holidays on which THIS store closes (owner
 * checklist in the BackOffice; a row = closed). holiday_key references the
 * deterministic French-holiday keys. Read ONLY through the schedule resolver
 * (holiday closure beats the weekly row). No default rows — never assumed.
 */
@Entity({ schema: 'analytics', name: 'store_holiday_closures' })
@Index(['storeId', 'holidayKey'], { unique: true })
export class AnalyticsStoreHolidayClosureEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'holiday_key', type: 'varchar', length: 40 })
  holidayKey: string;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
