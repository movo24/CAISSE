import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/**
 * NOTIFY — delivery ledger (étage 4). INV-6 structural: at most ONE delivery per
 * (alert, device), enforced by the UNIQUE index and absorbed at write time
 * (insert + 23505 → already delivered) — the same prevent-at-write pattern as the
 * alert dedup. A quiet-hours or disabled-prefs skip records NOTHING (the alert
 * stays eligible on the next tick); only an actual send claims the key.
 */
@Entity({ schema: 'notify', name: 'deliveries' })
@Index(['alertId', 'deviceId'], { unique: true })
@Index(['deviceId'])
export class NotifyDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'alert_id', type: 'uuid' })
  alertId: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;

  /** Sender channel that carried it ('log' = the provider-free floor). */
  @Column({ name: 'channel', type: 'varchar' })
  channel: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
