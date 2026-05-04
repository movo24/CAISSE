import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('idempotency_keys')
@Index(['expiresAt'])
export class IdempotencyKeyEntity {
  @PrimaryColumn({ length: 64 })
  key: string;

  @Column({ length: 100 })
  endpoint: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ name: 'response_status', type: 'int', nullable: true })
  responseStatus: number | null;

  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;
}
