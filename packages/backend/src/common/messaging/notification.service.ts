import { Injectable, Logger } from '@nestjs/common';
import { MailService } from './mail.service';
import { SmsService } from './sms.service';
import { MailMessage, SmsMessage, DeliveryResult } from './messaging.types';

/**
 * NotificationService — high-level multi-channel sender used by features
 * (shift reminders, loyalty OTP, …). It delegates to MailService / SmsService,
 * picks the preferred channel when available, and falls back to the other.
 *
 * Fully graceful: with no provider configured every call returns
 * { skipped: true } and nothing breaks.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly mail: MailService,
    private readonly sms: SmsService,
  ) {}

  get smsEnabled(): boolean {
    return this.sms.isEnabled();
  }

  get emailEnabled(): boolean {
    return this.mail.isEnabled();
  }

  /**
   * Send via the preferred channel, falling back to the other if the preferred
   * one is not configured. Returns the result of whichever channel ran (or a
   * skipped result if neither is configured).
   */
  async notify(opts: {
    prefer?: 'sms' | 'email';
    sms?: SmsMessage;
    email?: MailMessage;
  }): Promise<DeliveryResult> {
    const prefer = opts.prefer ?? 'email';
    const order: Array<'sms' | 'email'> = prefer === 'sms' ? ['sms', 'email'] : ['email', 'sms'];

    for (const channel of order) {
      if (channel === 'sms' && opts.sms && this.sms.isEnabled()) {
        return this.sms.send(opts.sms);
      }
      if (channel === 'email' && opts.email && this.mail.isEnabled()) {
        return this.mail.send(opts.email);
      }
    }

    this.logger.debug('[NOTIFY skipped] no configured channel for this notification');
    return { ok: false, skipped: true, provider: 'none' };
  }
}
