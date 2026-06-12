/**
 * Étage 2 — alert rule contract. A rule derives FACTS from `analytics.*` (INV-2/
 * INV-4: it compares figures the projection already carries; it never recomputes a
 * truth and never touches a source table). Delivery is étage 4's problem.
 */
export interface AlertFact {
  rule: string;
  /** Dedup-key component — severity band ('warning', 'critical', 'rupture', …). */
  thresholdBand: string;
  /** The business day the fact belongs to (may be a closed prior day). */
  businessDay: string;
  /** Evidence: observed value, threshold, counts — traceable to analytics.*. */
  payload?: Record<string, unknown>;
}

export interface AlertRuleContext {
  storeId: string;
  /** Current business day (UTC) at evaluation time. */
  businessDay: string;
  now: Date;
  /** Resolved config params (store override else seeded default); null = no config. */
  params: Record<string, unknown> | null;
}

export interface AlertRule {
  readonly name: string;
  evaluate(ctx: AlertRuleContext): Promise<AlertFact[]>;
}

/** DI token: the rules registered on the engine (one rule per commit). */
export const ALERT_RULES = 'ALERT_RULES';
