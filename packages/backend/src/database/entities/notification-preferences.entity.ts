import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('notification_preferences')
export class NotificationPreferencesEntity {
  @PrimaryColumn({ name: 'customer_id' })
  customerId: string;

  @Column({ name: 'new_products', default: true })
  newProducts: boolean;

  @Column({ default: true })
  discounts: boolean;

  @Column({ name: 'limited_drops', default: true })
  limitedDrops: boolean;

  @Column({ name: 'store_events', default: true })
  storeEvents: boolean;

  @Column({ name: 'loyalty_reminders', default: true })
  loyaltyReminders: boolean;

  @CreateDateColumn({ name: 'consent_given_at', nullable: true })
  consentGivenAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
