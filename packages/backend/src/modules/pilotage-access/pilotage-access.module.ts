import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { EmployeeApplicationAccessEntity } from '../../database/entities/employee-application-access.entity';
import { EmployeeStoreAccessEntity } from '../../database/entities/employee-store-access.entity';
import { AccessAuditLogEntity } from '../../database/entities/access-audit-log.entity';
import { AccessService } from './access.service';
import { AccessAuditService } from './access-audit.service';
import { StoreAccessGuard } from './store-access.guard';
import { PilotageAccessController } from './pilotage-access.controller';

/**
 * Module de pilotage-access : RBAC applicatif (accès application + périmètre magasin +
 * permissions granulaires + validité) + guard de contrôle serveur + endpoints de périmètre.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      EmployeeEntity,
      EmployeeApplicationAccessEntity,
      EmployeeStoreAccessEntity,
      AccessAuditLogEntity,
    ]),
  ],
  controllers: [PilotageAccessController],
  providers: [AccessService, AccessAuditService, StoreAccessGuard],
  exports: [AccessService, AccessAuditService, StoreAccessGuard],
})
export class PilotageAccessModule {}
