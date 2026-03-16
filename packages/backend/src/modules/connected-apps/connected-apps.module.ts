import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectedAppEntity } from '../../database/entities/connected-app.entity';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { ConnectedAppsService } from './connected-apps.service';
import { ConnectedAppsController } from './connected-apps.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConnectedAppEntity, OrganizationEntity]),
  ],
  controllers: [ConnectedAppsController],
  providers: [ConnectedAppsService],
  exports: [ConnectedAppsService],
})
export class ConnectedAppsModule {}
