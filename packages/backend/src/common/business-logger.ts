import { Logger } from '@nestjs/common';

/**
 * Business Event Logger — structured JSON logs for business-critical events.
 *
 * These logs are separate from technical logs and designed for:
 * - Sales analytics
 * - Payment monitoring
 * - Error tracking
 * - Fraud detection
 *
 * Format: JSON with event type, timestamp, and contextual data.
 * Can be piped to ELK/Datadog/CloudWatch for dashboards.
 */
const logger = new Logger('BusinessEvent');

export type BusinessEventType =
  | 'SALE_COMPLETED'
  | 'SALE_VOIDED'
  | 'SALE_FAILED'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_TIMEOUT'
  | 'REFUND_ISSUED'
  | 'STOCK_ADJUSTED'
  | 'STOCK_ALERT'
  | 'EMPLOYEE_LOGIN'
  | 'EMPLOYEE_LOGOUT'
  | 'EMPLOYEE_LOCKOUT'
  | 'DISCOUNT_APPLIED'
  | 'VOID_ATTEMPTED'
  | 'SESSION_OPENED'
  | 'SESSION_CLOSED';

interface BusinessEvent {
  event: BusinessEventType;
  storeId?: string;
  employeeId?: string;
  data?: Record<string, unknown>;
}

export function logBusinessEvent(ev: BusinessEvent): void {
  const entry = {
    ...ev,
    timestamp: new Date().toISOString(),
  };
  // Structured JSON log — parseable by log aggregators
  logger.log(JSON.stringify(entry));
}
