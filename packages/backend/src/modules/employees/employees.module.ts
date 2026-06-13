import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployeesService } from './employees.service';
import { EmployeeStoreAccessService } from './employee-store-access.service';
import { EmployeesController } from './employees.controller';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { EmployeeStoreAccessEntity } from '../../database/entities/employee-store-access.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EmployeeEntity, EmployeeStoreAccessEntity, StoreEntity]),
    AuditModule,
  ],
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeeStoreAccessService],
  exports: [EmployeesService, EmployeeStoreAccessService],
})
export class EmployeesModule {}
