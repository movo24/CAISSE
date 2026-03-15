import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayrollConfigEntity } from '../../database/entities/payroll-config.entity';
import { PointageEntryEntity } from '../../database/entities/pointage-entry.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PayrollConfigEntity, PointageEntryEntity, EmployeeEntity]),
  ],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
