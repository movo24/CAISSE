import { Module } from '@nestjs/common';
import { ShiftReminderService } from './shift-reminder.service';

/**
 * Shift reminders — cron-driven pre-shift notifications.
 * TimewinService (global) and NotificationService (global) are injected directly.
 */
@Module({
  providers: [ShiftReminderService],
  exports: [ShiftReminderService],
})
export class ShiftRemindersModule {}
