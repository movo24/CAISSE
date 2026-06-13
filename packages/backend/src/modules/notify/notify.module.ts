import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsAlertEntity } from '../../database/entities/analytics-alert.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { NotifyDeviceTokenEntity } from '../../database/entities/notify-device-token.entity';
import { NotifyPreferenceEntity } from '../../database/entities/notify-preference.entity';
import { NotifyDeliveryEntity } from '../../database/entities/notify-delivery.entity';
import { AnalyticsStoreClockEntity } from '../../database/entities/analytics-store-clock.entity';
import { AnalyticsProjectionModule } from '../analytics-projection/analytics-projection.module';
import { NotifyAccountController } from './notify-account.controller';
import { NotifyDeliveryService } from './notify-delivery.service';
import { PUSH_SENDER, LogPushSender } from './push-sender.interface';

/**
 * Wesley Command Center — étage 4 (push). The account WRITE surface (device
 * registration + preferences, JwtAuthGuard, separate from the GET-only cockpit
 * router) and the delivery engine (alert facts → scoped devices, quiet hours,
 * store_closed_late delivery-frozen by D-ALERTS-1, INV-6 ledger). The concrete
 * push provider is an owner decision on the PUSH_SENDER seam — default = the
 * provider-free LOG floor.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnalyticsAlertEntity,
      EmployeeEntity,
      NotifyDeviceTokenEntity,
      NotifyPreferenceEntity,
      NotifyDeliveryEntity,
      AnalyticsStoreClockEntity,
    ]),
    AnalyticsProjectionModule,
  ],
  controllers: [NotifyAccountController],
  providers: [{ provide: PUSH_SENDER, useClass: LogPushSender }, NotifyDeliveryService],
  exports: [NotifyDeliveryService],
})
export class NotifyModule {}
