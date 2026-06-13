import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/**
 * NOTIFY — registered push devices (étage 4). Lives in the `notify` schema,
 * SEPARATE from `analytics`: the mobile API's future DB role keeps SELECT-only on
 * analytics (D-ANALYTICS-1) while the account surface writes here. Registered by
 * the app (étage 5) through the write surface (JwtAuthGuard, NOT the GET-only
 * cockpit router — INV-1 stays intact).
 */
@Entity({ schema: 'notify', name: 'device_tokens' })
@Index(['token'], { unique: true })
@Index(['employeeId'])
export class NotifyDeviceTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The owner — recipient scope is resolved from this employee (INV-5 resolver). */
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ name: 'platform', type: 'varchar' })
  platform: string; // 'ios' | 'android' | 'web'

  @Column({ name: 'token', type: 'varchar' })
  token: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
