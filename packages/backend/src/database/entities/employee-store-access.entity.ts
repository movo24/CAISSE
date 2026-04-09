import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('employee_store_access')
@Index('idx_esa_employee', ['employeeId'])
@Index('idx_esa_store', ['storeId'])
@Index('idx_esa_unique', ['employeeId', 'storeId'], { unique: true })
export class EmployeeStoreAccessEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  employeeId: string;

  @Column('uuid')
  storeId: string;

  @Column({ type: 'varchar', length: 50, default: 'active' })
  role: string;

  @CreateDateColumn()
  createdAt: Date;
}
