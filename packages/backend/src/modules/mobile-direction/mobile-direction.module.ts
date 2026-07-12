import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StoreEntity } from '../../database/entities/store.entity';
import { EmployeeStoreAccessEntity } from '../../database/entities/employee-store-access.entity';
import { MobileDirectionController } from './mobile-direction.controller';
import { MobileDirectionService } from './mobile-direction.service';

/**
 * Wesley Control — read-only network KPI API for the direction mobile app.
 * GET-only surface under /api/mobile/v1/direction (employee JWT, manager/admin).
 */
@Module({
  imports: [TypeOrmModule.forFeature([StoreEntity, EmployeeStoreAccessEntity])],
  controllers: [MobileDirectionController],
  providers: [MobileDirectionService],
})
export class MobileDirectionModule {}
