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

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column()
  name: string;

  /** Type: retail, warehouse, headquarters, franchise, popup */
  @Column({ default: 'retail' })
  type: string;

  @Column({ default: 'FR' })
  country: string;

  @Column({ name: 'currency_code', default: 'EUR' })
  currencyCode: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ nullable: true, type: 'text' })
  notes: string;

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
