import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { StoreEntity } from './store.entity';

/**
 * SaaS subscription / license for a store.
 *
 * Plans:
 *   - trial:      14 days free, 1 POS terminal, 100 products
 *   - starter:    1 POS terminal, 500 products, basic reports
 *   - business:   3 POS terminals, unlimited products, full reports, IA
 *   - enterprise: unlimited terminals, white-label, priority support, API access
 *
 * Billing:
 *   - All amounts in minor units (centimes EUR)
 *   - Stripe integration planned for V1
 */
@Entity('subscriptions')
@Index(['storeId'], { unique: true })
export class SubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({
    type: 'varchar',
    default: 'trial',
  })
  plan: 'trial' | 'starter' | 'business' | 'enterprise';

  @Column({
    type: 'varchar',
    default: 'active',
  })
  status: 'active' | 'trial' | 'past_due' | 'cancelled' | 'suspended';

  // --- Billing ---
  @Column({ name: 'price_minor_units', type: 'integer', default: 0 })
  priceMinorUnits: number;

  @Column({ name: 'currency_code', default: 'EUR' })
  currencyCode: string;

  @Column({
    name: 'billing_cycle',
    type: 'varchar',
    default: 'monthly',
  })
  billingCycle: 'monthly' | 'yearly';

  // --- Dates ---
  @Column({ name: 'trial_ends_at', nullable: true })
  trialEndsAt: Date;

  @Column({ name: 'current_period_start', nullable: true })
  currentPeriodStart: Date;

  @Column({ name: 'current_period_end', nullable: true })
  currentPeriodEnd: Date;

  @Column({ name: 'cancelled_at', nullable: true })
  cancelledAt: Date;

  // --- Limits ---
  @Column({ name: 'max_terminals', type: 'integer', default: 1 })
  maxTerminals: number;

  @Column({ name: 'max_products', type: 'integer', default: 100 })
  maxProducts: number;

  @Column({ name: 'max_employees', type: 'integer', default: 2 })
  maxEmployees: number;

  @Column({ name: 'features_enabled', type: 'jsonb', default: '[]' })
  featuresEnabled: string[];

  // --- External billing ---
  @Column({ name: 'stripe_customer_id', nullable: true })
  stripeCustomerId: string;

  @Column({ name: 'stripe_subscription_id', nullable: true })
  stripeSubscriptionId: string;

  // --- Timestamps ---
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // --- Relations ---
  @ManyToOne(() => StoreEntity)
  @JoinColumn({ name: 'store_id' })
  store: StoreEntity;
}
