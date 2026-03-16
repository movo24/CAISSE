import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { UnitEntity } from './unit.entity';
import { StoreEntity } from './store.entity';

@Entity('organizations')
export class OrganizationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'legal_name', nullable: true })
  legalName: string;

  @Column({ nullable: true })
  siret: string;

  @Column({ nullable: true })
  siren: string;

  @Column({ name: 'tva_intracom', nullable: true })
  tvaIntracom: string;

  @Column({ default: 'FR' })
  country: string;

  @Column({ name: 'currency_code', default: 'EUR' })
  currencyCode: string;

  @Column({ name: 'logo_url', nullable: true, type: 'text' })
  logoUrl: string | null;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  city: string;

  @Column({ name: 'postal_code', nullable: true })
  postalCode: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ nullable: true, type: 'text' })
  notes: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => UnitEntity, (u) => u.organization)
  units: UnitEntity[];

  @OneToMany(() => StoreEntity, (s) => s.organization)
  stores: StoreEntity[];
}
