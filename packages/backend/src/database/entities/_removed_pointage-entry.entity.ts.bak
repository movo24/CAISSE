import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('pointage_entries')
@Index(['storeId', 'timestamp'])
@Index(['employeeId', 'timestamp'])
export class PointageEntryEntity {
  @PrimaryColumn()
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'employee_id' })
  employeeId: string;

  @Column({ name: 'employee_name' })
  employeeName: string;

  @Column()
  type: string; // clock_in | clock_out | break_start | break_end

  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ default: 'manual' })
  source: string; // auto_login | auto_logout | manual

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
