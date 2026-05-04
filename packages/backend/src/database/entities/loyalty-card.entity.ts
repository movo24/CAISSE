import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type LoyaltyCardStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

@Entity('loyalty_cards')
@Index(['customerId'])
@Index(['status'])
export class LoyaltyCardEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', unique: true })
  customerId: string;

  @Column({ name: 'public_code', unique: true, length: 20 })
  publicCode: string;

  @Column({ name: 'qr_secret', length: 64 })
  qrSecret: string;

  @Column({ length: 20, default: 'ACTIVE' })
  status: LoyaltyCardStatus;

  @CreateDateColumn({ name: 'issued_at' })
  issuedAt: Date;

  @Column({ name: 'rotated_at', type: 'timestamp', nullable: true })
  rotatedAt: Date | null;

  @Column({ name: 'suspended_at', type: 'timestamp', nullable: true })
  suspendedAt: Date | null;

  @Column({ name: 'suspended_reason', type: 'text', nullable: true })
  suspendedReason: string | null;
}
