import { Logger } from '@nestjs/common';

/**
 * AlertService — lightweight alerting for critical system events.
 *
 * Channels:
 *   1. Structured console logs (always active)
 *   2. Webhook (Slack/Discord/custom — if ALERT_WEBHOOK_URL is set)
 *
 * Events tracked:
 *   - REDIS_DOWN / REDIS_RECOVERED
 *   - TIMEWIN_DOWN / TIMEWIN_RECOVERED
 *   - CIRCUIT_BREAKER_OPEN / CIRCUIT_BREAKER_CLOSED
 *   - LOGIN_BRUTEFORCE
 *   - RATE_LIMIT_BURST
 *
 * Singleton pattern — accessible from anywhere without DI.
 */

export type AlertEvent =
  | 'REDIS_DOWN'
  | 'REDIS_RECOVERED'
  | 'TIMEWIN_DOWN'
  | 'TIMEWIN_RECOVERED'
  | 'CIRCUIT_BREAKER_OPEN'
  | 'CIRCUIT_BREAKER_CLOSED'
  | 'LOGIN_BRUTEFORCE'
  | 'RATE_LIMIT_BURST'
  // A stock count revealed a shortage ≥ threshold — needs human verification.
  | 'STOCK_VARIANCE_HIGH'
  // A sale completed with an uncaptured card leg — payment to regularise.
  | 'PAYMENT_PENDING_CAPTURE'
  // An audit-chain append was DROPPED after exhausting anti-fork retries (D16).
  // The audited op already committed (audit is out-of-band) → integrity gap to act on.
  | 'AUDIT_WRITE_FAILED';

export interface AlertEntry {
  event: AlertEvent;
  message: string;
  timestamp: string;
}

export class AlertService {
  private static _instance: AlertService;
  private readonly logger = new Logger('Alert');
  private readonly webhookUrl: string | null;
  private readonly history: AlertEntry[] = [];
  private readonly maxHistory = 100;

  // Dedup: don't fire the same event more than once per cooldown
  private readonly cooldowns = new Map<AlertEvent, number>();
  private readonly cooldownMs = 60_000; // 1 minute between duplicate alerts

  private constructor() {
    this.webhookUrl = process.env.ALERT_WEBHOOK_URL || null;
  }

  static get instance(): AlertService {
    if (!AlertService._instance) {
      AlertService._instance = new AlertService();
    }
    return AlertService._instance;
  }

  /**
   * Fire an alert. Deduped by event type (1 per minute max per event).
   */
  fire(event: AlertEvent, message: string): void {
    // Dedup check
    const lastFired = this.cooldowns.get(event);
    if (lastFired && Date.now() - lastFired < this.cooldownMs) {
      return;
    }
    this.cooldowns.set(event, Date.now());

    const entry: AlertEntry = {
      event,
      message,
      timestamp: new Date().toISOString(),
    };

    // Record history
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Channel 1: Structured console log
    const severity = this.getSeverity(event);
    const logEntry = JSON.stringify({
      alert: true,
      severity,
      event,
      message,
      ts: entry.timestamp,
    });

    if (severity === 'critical') {
      this.logger.error(logEntry);
    } else if (severity === 'warning') {
      this.logger.warn(logEntry);
    } else {
      this.logger.log(logEntry);
    }

    // Channel 2: Webhook (fire-and-forget)
    if (this.webhookUrl) {
      this.sendWebhook(entry).catch(() => {});
    }
  }

  /**
   * Get recent alerts (for /health or /metrics endpoint).
   */
  getRecent(count = 10): AlertEntry[] {
    return this.history.slice(-count);
  }

  private getSeverity(event: AlertEvent): 'critical' | 'warning' | 'info' {
    switch (event) {
      case 'REDIS_DOWN':
      case 'TIMEWIN_DOWN':
      case 'CIRCUIT_BREAKER_OPEN':
      case 'LOGIN_BRUTEFORCE':
      case 'AUDIT_WRITE_FAILED':
        return 'critical';
      case 'RATE_LIMIT_BURST':
      case 'STOCK_VARIANCE_HIGH':
      case 'PAYMENT_PENDING_CAPTURE':
        return 'warning';
      default:
        return 'info';
    }
  }

  private async sendWebhook(entry: AlertEntry): Promise<void> {
    if (!this.webhookUrl) return;
    try {
      await globalThis.fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `[POS ALERT] ${entry.event}: ${entry.message}`,
          ...entry,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      this.logger.warn(`Webhook delivery failed: ${(err as Error).message}`);
    }
  }
}
