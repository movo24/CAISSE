import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { OrganizationEntity } from './organization.entity';
import { StoreEntity } from './store.entity';

@Entity('units')
@Index(['organizationId', 'isActive'])
export class UnitEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  code: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Type: retail, warehouse, headquarters, franchise, popup */
  @Column({ type: 'varchar', default: 'retail' })
  type: string;

  @Column({ type: 'varchar', default: 'FR' })
  country: string;

  @Column({ name: 'currency_code', type: 'varchar', default: 'EUR' })
  currencyCode: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => OrganizationEntity, (o) => o.units)
  @JoinColumn({ name: 'organization_id' })
  organization: OrganizationEntity;

  @OneToMany(() => StoreEntity, (s) => s.unit)
  stores: StoreEntity[];
}
