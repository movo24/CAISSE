import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * NOTIFY — per-employee delivery preferences (étage 4). Quiet hours are USER DATA
 * with NO invented defaults: both hours null = no quiet window (deliver any time).
 * When set, the window is wall-clock (UTC stand-in — same documented convention as
 * store_clock until the TZ policy lands) and may wrap midnight (22 → 7).
 * Quiet hours are a DELIVERY policy (étage 4) — the alert FACTS (étage 2) are
 * generated regardless; only the push is held.
 */
@Entity({ schema: 'notify', name: 'preferences' })
export class NotifyPreferenceEntity {
  @PrimaryColumn({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'quiet_start_hour', type: 'integer', nullable: true })
  quietStartHour: number | null;

  @Column({ name: 'quiet_end_hour', type: 'integer', nullable: true })
  quietEndHour: number | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
