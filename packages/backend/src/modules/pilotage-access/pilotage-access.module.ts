import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { EmployeeApplicationAccessEntity } from '../../database/entities/employee-application-access.entity';
import { EmployeeStoreAccessEntity } from '../../database/entities/employee-store-access.entity';
import { AccessService } from './access.service';

/**
 * Module de pilotage-access : RBAC applicatif (accès application + périmètre magasin +
 * permissions granulaires + validité). Le guard et les endpoints admin s'ajoutent au Lot 3+.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      EmployeeEntity,
      EmployeeApplicationAccessEntity,
      EmployeeStoreAccessEntity,
    ]),
  ],
  providers: [AccessService],
  exports: [AccessService],
})
export class PilotageAccessModule {}
