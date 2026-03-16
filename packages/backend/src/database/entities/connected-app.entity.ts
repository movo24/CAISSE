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
import { OrganizationEntity } from './organization.entity';

@Entity('connected_apps')
@Index(['organizationId', 'isActive'])
export class ConnectedAppEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column()
  name: string;

  /** internal = built by us, external = third-party, rented = SaaS subscription */
  @Column({ default: 'internal' })
  type: string;

  /** active, inactive, error, syncing */
  @Column({ default: 'active' })
  status: string;

  @Column({ name: 'app_url', nullable: true })
  appUrl: string;

  @Column({ name: 'api_url', nullable: true })
  apiUrl: string;

  @Column({ name: 'webhook_url', nullable: true })
  webhookUrl: string;

  @Column({ name: 'api_key', nullable: true })
  apiKey: string;

  @Column({ name: 'icon_url', nullable: true, type: 'text' })
  iconUrl: string | null;

  @Column({ nullable: true, type: 'text' })
  description: string;

  /** JSON array of unit IDs this app is assigned to */
  @Column({ name: 'unit_ids', type: 'jsonb', default: '[]' })
  unitIds: string[];

  /** JSON array of store IDs this app is assigned to */
  @Column({ name: 'store_ids', type: 'jsonb', default: '[]' })
  storeIds: string[];

  @Column({ name: 'last_sync_at', nullable: true })
  lastSyncAt: Date;

  @Column({ name: 'last_error', nullable: true, type: 'text' })
  lastError: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => OrganizationEntity)
  @JoinColumn({ name: 'organization_id' })
  organization: OrganizationEntity;
}
