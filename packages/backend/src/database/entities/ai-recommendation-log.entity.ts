import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/**
 * AI Recommendation Log — tracks every recommendation shown, clicked, converted.
 * Used by the learning engine to improve future recommendations.
 */
@Entity('ai_recommendation_logs')
@Index(['storeId', 'createdAt'])
@Index(['suggestedProductId', 'clicked'])
@Index(['employeeId', 'converted'])
export class AiRecommendationLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'employee_id', nullable: true })
  employeeId: string | null;

  // What was in the cart when reco was shown
  @Column({ name: 'trigger_product_id' })
  triggerProductId: string;

  @Column({ name: 'trigger_product_name', type: 'varchar' })
  triggerProductName: string;

  // What was recommended
  @Column({ name: 'suggested_product_id' })
  suggestedProductId: string;

  @Column({ name: 'suggested_product_name', type: 'varchar' })
  suggestedProductName: string;

  // AI scoring at time of recommendation
  @Column({ type: 'real', default: 0 })
  confidence: number;

  @Column({ name: 'estimated_cash_impact', type: 'integer', default: 0 })
  estimatedCashImpact: number; // cents

  @Column({ name: 'margin_percent', type: 'real', default: 0 })
  marginPercent: number;

  // Tracking
  @Column({ default: true })
  displayed: boolean;

  @Column({ default: false })
  clicked: boolean;

  @Column({ name: 'added_to_cart', default: false })
  addedToCart: boolean;

  @Column({ default: false })
  converted: boolean; // Was the sale completed with this product?

  // Revenue tracking
  @Column({ name: 'revenue_generated', type: 'integer', default: 0 })
  revenueGenerated: number; // cents

  @Column({ name: 'margin_generated', type: 'integer', default: 0 })
  marginGenerated: number; // cents

  // Link to sale if converted
  @Column({ name: 'sale_id', type: 'uuid', nullable: true })
  saleId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
