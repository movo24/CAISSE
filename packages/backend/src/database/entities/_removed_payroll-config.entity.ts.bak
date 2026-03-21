import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

@Entity('payroll_configs')
@Index(['storeId', 'employeeId'], { unique: true })
export class PayrollConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id' })
  storeId: string;

  @Column({ name: 'employee_id' })
  employeeId: string;

  @Column({ name: 'hourly_rate_gross', default: 1200 })
  hourlyRateGross: number; // centimes (12.00€ = 1200)

  @Column({ name: 'contract_hours_week', type: 'decimal', default: 35 })
  contractHoursWeek: number;
}
