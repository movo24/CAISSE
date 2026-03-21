import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { StoreEntity } from './store.entity';

export enum TerminalProvider {
  STRIPE = 'STRIPE',
}

export enum TerminalDeviceType {
  WISEPAD_3 = 'WISEPAD_3',
  STRIPE_M2 = 'STRIPE_M2',
  STRIPE_S700 = 'STRIPE_S700',
}

export enum TerminalStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  ERROR = 'ERROR',
}

@Entity('payment_terminals')
@Index(['storeId', 'isActive'])
@Unique(['storeId', 'stripeReaderId'])
export class PaymentTerminalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'varchar' })
  storeId: string;

  @ManyToOne(() => StoreEntity)
  @JoinColumn({ name: 'store_id' })
  store: StoreEntity;

  @Column({ type: 'enum', enum: TerminalProvider, default: TerminalProvider.STRIPE })
  provider: TerminalProvider;

  @Column({ name: 'device_type', type: 'enum', enum: TerminalDeviceType, default: TerminalDeviceType.WISEPAD_3 })
  deviceType: TerminalDeviceType;

  @Column({ type: 'varchar', default: 'Terminal Caisse' })
  label: string;

  @Column({ name: 'serial_number', type: 'varchar', nullable: true })
  serialNumber: string | null;

  @Column({ name: 'stripe_reader_id', type: 'varchar', nullable: true })
  stripeReaderId: string | null;

  @Column({ name: 'stripe_location_id', type: 'varchar', nullable: true })
  stripeLocationId: string | null;

  @Column({ name: 'registration_code', type: 'varchar', nullable: true })
  registrationCode: string | null;

  @Column({ type: 'enum', enum: TerminalStatus, default: TerminalStatus.OFFLINE })
  status: TerminalStatus;

  @Column({ name: 'last_seen_at', type: 'timestamp', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'battery_level', type: 'integer', nullable: true })
  batteryLevel: number | null;

  @Column({ name: 'firmware_version', type: 'varchar', nullable: true })
  firmwareVersion: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
