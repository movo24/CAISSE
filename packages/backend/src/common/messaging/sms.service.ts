import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsMessage, DeliveryResult } from './messaging.types';

type SmsProviderName = 'twilio' | 'none';

/**
 * SmsService — provider-agnostic transactional SMS.
 *
 * Provider from env (graceful degradation):
 *   - SMS_PROVIDER=twilio|none (explicit), else auto:
 *   - TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM present → twilio (REST, no SDK)
 *   - otherwise → none (logs + { skipped: true })
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly provider: SmsProviderName;

  constructor(private readonly config: ConfigService) {
    this.provider = this.resolveProvider();
    if (this.provider === 'none') {
      this.logger.warn('No SMS provider configured — SMS sends are disabled (no-op)');
    } else {
      this.logger.log('SMS provider: twilio');
    }
  }

  private resolveProvider(): SmsProviderName {
    const explicit = this.config.get<string>('SMS_PROVIDER');
    if (explicit === 'twilio' || explicit === 'none') return explicit;
    if (
      this.config.get<string>('TWILIO_ACCOUNT_SID') &&
      this.config.get<string>('TWILIO_AUTH_TOKEN') &&
      this.config.get<string>('TWILIO_FROM')
    ) {
      return 'twilio';
    }
    return 'none';
  }

  isEnabled(): boolean {
    return this.provider !== 'none';
  }

  async send(msg: SmsMessage): Promise<DeliveryResult> {
    if (this.provider === 'none') {
      this.logger.debug(`[SMS skipped] would send to ${msg.to}`);
      return { ok: false, skipped: true, provider: 'none' };
    }
    try {
      return await this.sendViaTwilio(msg);
    } catch (err: any) {
      this.logger.error(`[SMS_FAILED] to=${msg.to}: ${err?.message}`);
      return { ok: false, skipped: false, provider: 'twilio', error: err?.message };
    }
  }

  private async sendViaTwilio(msg: SmsMessage): Promise<DeliveryResult> {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID')!;
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN')!;
    const from = this.config.get<string>('TWILIO_FROM')!;
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const body = new URLSearchParams({ From: from, To: msg.to, Body: msg.body });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Twilio ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { ok: true, skipped: false, provider: 'twilio' };
  }
}
