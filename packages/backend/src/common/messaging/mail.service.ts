import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailMessage, DeliveryResult } from './messaging.types';

type MailProviderName = 'sendgrid' | 'smtp' | 'none';

/**
 * MailService — provider-agnostic transactional email.
 *
 * Provider is chosen from env (graceful degradation, like TimeWin24):
 *   - MAIL_PROVIDER=sendgrid|smtp|none  (explicit), else auto-detected:
 *   - SENDGRID_API_KEY present        → sendgrid (REST, no SDK)
 *   - SMTP_HOST present               → smtp (nodemailer)
 *   - otherwise                       → none (logs + returns { skipped: true })
 *
 * No secrets are hard-coded; everything comes from env. With no provider
 * configured the app boots and runs normally — sends are no-ops.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly provider: MailProviderName;
  private readonly from: string;
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    this.from = this.config.get<string>('MAIL_FROM', 'no-reply@caisse.local');
    this.provider = this.resolveProvider();
    if (this.provider === 'none') {
      this.logger.warn('No mail provider configured — email sends are disabled (no-op)');
    } else {
      this.logger.log(`Mail provider: ${this.provider} (from: ${this.from})`);
    }
  }

  private resolveProvider(): MailProviderName {
    const explicit = this.config.get<string>('MAIL_PROVIDER');
    if (explicit === 'sendgrid' || explicit === 'smtp' || explicit === 'none') {
      return explicit;
    }
    if (this.config.get<string>('SENDGRID_API_KEY')) return 'sendgrid';
    if (this.config.get<string>('SMTP_HOST')) return 'smtp';
    return 'none';
  }

  isEnabled(): boolean {
    return this.provider !== 'none';
  }

  async send(msg: MailMessage): Promise<DeliveryResult> {
    if (this.provider === 'none') {
      this.logger.debug(`[MAIL skipped] would send "${msg.subject}" to ${msg.to}`);
      return { ok: false, skipped: true, provider: 'none' };
    }
    try {
      if (this.provider === 'sendgrid') return await this.sendViaSendgrid(msg);
      return await this.sendViaSmtp(msg);
    } catch (err: any) {
      this.logger.error(`[MAIL_FAILED] provider=${this.provider} to=${msg.to}: ${err?.message}`);
      return { ok: false, skipped: false, provider: this.provider, error: err?.message };
    }
  }

  private async sendViaSendgrid(msg: MailMessage): Promise<DeliveryResult> {
    const apiKey = this.config.get<string>('SENDGRID_API_KEY')!;
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: msg.to }] }],
        from: { email: this.from },
        subject: msg.subject,
        content: [
          { type: 'text/plain', value: msg.text || stripHtml(msg.html) },
          { type: 'text/html', value: msg.html },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`SendGrid ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { ok: true, skipped: false, provider: 'sendgrid' };
  }

  private async sendViaSmtp(msg: MailMessage): Promise<DeliveryResult> {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port: parseInt(this.config.get<string>('SMTP_PORT', '587'), 10),
        secure: this.config.get<string>('SMTP_SECURE') === 'true',
        auth: this.config.get<string>('SMTP_USER')
          ? {
              user: this.config.get<string>('SMTP_USER'),
              pass: this.config.get<string>('SMTP_PASS'),
            }
          : undefined,
      });
    }
    await this.transporter.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text || stripHtml(msg.html),
    });
    return { ok: true, skipped: false, provider: 'smtp' };
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
