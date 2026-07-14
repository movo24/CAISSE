import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { EmployeeApplicationAccessEntity } from '../../database/entities/employee-application-access.entity';
import { EmployeeStoreAccessEntity } from '../../database/entities/employee-store-access.entity';
import { AccessAuditLogEntity } from '../../database/entities/access-audit-log.entity';
import { AccessService } from './access.service';
import { AccessAuditService } from './access-audit.service';
import { AccessAdminService } from './access-admin.service';
import { StoreAccessGuard } from './store-access.guard';
import { PilotageAccessController } from './pilotage-access.controller';
import { PilotageAccessAdminController } from './pilotage-access-admin.controller';

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
  controllers: [PilotageAccessController, PilotageAccessAdminController],
  providers: [AccessService, AccessAuditService, AccessAdminService, StoreAccessGuard],
  exports: [AccessService, AccessAuditService, AccessAdminService, StoreAccessGuard],
})
export class PilotageAccessModule {}
