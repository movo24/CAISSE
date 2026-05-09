import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type NotificationCategory =
  | 'NEW_PRODUCT'
  | 'DISCOUNT_AVAILABLE'
  | 'LIMITED_DROP'
  | 'STORE_EVENT'
  | 'LOYALTY_REMINDER';

@Entity('notifications_log')
@Index(['customerId'])
export class NotificationsLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ length: 30 })
  category: NotificationCategory;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'sent_at' })
  sentAt: Date;

  @Column({ name: 'delivered_at', type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  @Column({ name: 'opened_at', type: 'timestamp', nullable: true })
  openedAt: Date | null;

  @Column({ name: 'apns_message_id', length: 64, nullable: true })
  apnsMessageId: string | null;
}
