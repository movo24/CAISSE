/** A transactional email message. */
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text fallback. Derived from html if omitted. */
  text?: string;
}

/** A transactional SMS message. */
export interface SmsMessage {
  to: string;
  body: string;
}

/**
 * Result of a delivery attempt. `skipped: true` means no provider was configured
 * (graceful degradation — never an error), so callers can treat it as a non-fatal
 * no-op exactly like the TimeWin24 integration does when disabled.
 */
export interface DeliveryResult {
  ok: boolean;
  skipped: boolean;
  provider: string;
  error?: string;
}
