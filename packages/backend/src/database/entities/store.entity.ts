import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { EmployeeEntity } from './employee.entity';
import { ProductEntity } from './product.entity';
import { OrganizationEntity } from './organization.entity';
import { UnitEntity } from './unit.entity';

@Entity('stores')
@Index(['organizationId', 'isActive'])
@Index(['unitId', 'isActive'])
export class StoreEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Hierarchy: Organization → Unit → Store ──

  @Column({ name: 'organization_id', nullable: true })
  organizationId: string | null;

  @Column({ name: 'unit_id', nullable: true })
  unitId: string | null;

  @Column({ name: 'store_code', nullable: true })
  storeCode: string;

  @Column()
  name: string;

  @Column()
  address: string;

  @Column({ name: 'postal_code', nullable: true })
  postalCode: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ name: 'currency_code', default: 'EUR' })
  currencyCode: string;

  @Column({ default: 'Europe/Paris' })
  timezone: string;

  @Column({ name: 'tax_id', nullable: true })
  taxId: string;

  // ── French legal compliance fields ──

  @Column({ nullable: true })
  siret: string;

  @Column({ nullable: true })
  siren: string;

  @Column({ nullable: true })
  naf: string;

  @Column({ name: 'tva_intracom', nullable: true })
  tvaIntracom: string;

  @Column({ nullable: true })
  rcs: string;

  @Column({ name: 'capital_social', nullable: true })
  capitalSocial: string;

  @Column({ name: 'forme_juridique', nullable: true })
  formeJuridique: string;

  // ── POS software identification ──

  @Column({ name: 'software_name', default: 'CAISSE POS' })
  softwareName: string;

  @Column({ name: 'software_version', default: '1.0.0' })
  softwareVersion: string;

  @Column({ name: 'nif_caisse', nullable: true })
  nifCaisse: string;

  // ── Ticket customization ──

  @Column({ name: 'header_message', nullable: true })
  headerMessage: string;

  @Column({ name: 'footer_message', nullable: true })
  footerMessage: string;

  // ── Geolocation (weather, map) ──

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude: number | null;

  // ── Network (multi-store grouping) ──

  @Column({ name: 'network_id', type: 'varchar', nullable: true })
  networkId: string | null;

  // ── System fields ──

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ── Relations ──

  @ManyToOne(() => OrganizationEntity, (o) => o.stores, { nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization: OrganizationEntity;

  @ManyToOne(() => UnitEntity, (u) => u.stores, { nullable: true })
  @JoinColumn({ name: 'unit_id' })
  unit: UnitEntity;

  @OneToMany(() => EmployeeEntity, (e) => e.store)
  employees: EmployeeEntity[];

  @OneToMany(() => ProductEntity, (p) => p.store)
  products: ProductEntity[];
}
