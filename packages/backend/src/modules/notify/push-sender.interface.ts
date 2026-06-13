import { Logger } from '@nestjs/common';

/**
 * Étage 4 — the push-provider seam (same doctrine as BRIEF_NARRATOR): the
 * concrete provider (FCM / APNs / Expo / WebPush) is an OWNER decision —
 * surfaced, never hardcoded. Any provider implements this interface and is wired
 * on PUSH_SENDER; the default is the provider-free LOG floor: deliveries are
 * claimed and logged, nothing leaves the server, the whole étage is testable and
 * deployable with zero external dependency. Push is an enhancement — the alert
 * FACTS stay visible in the cockpit regardless.
 */
export const PUSH_SENDER = 'PUSH_SENDER';

export interface PushPayload {
  title: string;
  body: string;
  /** Identifiers only — never metric values (the cockpit is the numbers surface). */
  data: Record<string, string>;
}

export interface PushSender {
  /** Channel label recorded on the delivery ledger. */
  readonly channel: string;
  send(device: { token: string; platform: string }, payload: PushPayload): Promise<void>;
}

/** The provider-free floor: logs the delivery. */
export class LogPushSender implements PushSender {
  readonly channel = 'log';
  private readonly logger = new Logger(LogPushSender.name);

  async send(device: { token: string; platform: string }, payload: PushPayload): Promise<void> {
    this.logger.log(
      `[push:floor] ${device.platform}/${device.token.slice(0, 8)}… ← ${payload.title} (${payload.data.rule ?? '?'})`,
    );
  }
}
