import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { SmsService } from './sms.service';
import { NotificationService } from './notification.service';

/**
 * Global messaging module — exposes MailService, SmsService and the high-level
 * NotificationService everywhere without per-module imports. ConfigModule is
 * already global, so providers read env directly.
 */
@Global()
@Module({
  providers: [MailService, SmsService, NotificationService],
  exports: [MailService, SmsService, NotificationService],
})
export class MessagingModule {}
