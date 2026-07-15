/**
 * Évaluateur de risque de connexion — PUR et EXPLICABLE (spec §14).
 *
 * Ne bloque jamais automatiquement sur un simple changement de ville : produit un score
 * de risque avec des raisons lisibles. La décision d'alerter revient au service.
 */
export interface LoginSignal {
  success: boolean;
  countryCode?: string | null;
  userAgent?: string | null;
  occurredAt: Date;
}

export interface RiskAssessment {
  riskScore: number;
  reasons: string[];
}

export const RISK_WEIGHTS = {
  new_device: 30,
  new_country: 25,
  impossible_travel: 40,
  repeated_failures: 20,
} as const;

/** Seuil au-delà duquel une alerte de sécurité est levée. */
export const RISK_ALERT_THRESHOLD = 60;

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function ts(d: Date | string): number {
  return new Date(d).getTime();
}

/**
 * Évalue le risque d'un login `current` au regard de l'historique `history`
 * (événements antérieurs, ordre indifférent). Score borné à 100.
 */
export function assessLoginRisk(current: LoginSignal, history: LoginSignal[]): RiskAssessment {
  const reasons: string[] = [];
  let score = 0;
  const priorSuccess = history.filter((h) => h.success);

  // Nouvel appareil : user-agent jamais vu en succès.
  if (current.userAgent && !priorSuccess.some((h) => h.userAgent === current.userAgent)) {
    score += RISK_WEIGHTS.new_device;
    reasons.push('new_device');
  }

  // Nouveau pays : on a un historique mais jamais ce pays.
  if (current.countryCode && priorSuccess.length && !priorSuccess.some((h) => h.countryCode === current.countryCode)) {
    score += RISK_WEIGHTS.new_country;
    reasons.push('new_country');
  }

  // Voyage impossible : dernier login réussi dans un autre pays il y a < 2h.
  const lastGeo = priorSuccess
    .filter((h) => h.countryCode)
    .sort((a, b) => ts(b.occurredAt) - ts(a.occurredAt))[0];
  if (
    lastGeo &&
    current.countryCode &&
    lastGeo.countryCode !== current.countryCode &&
    ts(current.occurredAt) - ts(lastGeo.occurredAt) < TWO_HOURS_MS
  ) {
    score += RISK_WEIGHTS.impossible_travel;
    reasons.push('impossible_travel');
  }

  // Échecs répétés dans les 15 dernières minutes.
  const recentFailures = history.filter(
    (h) => !h.success && ts(current.occurredAt) - ts(h.occurredAt) < FIFTEEN_MIN_MS && ts(h.occurredAt) <= ts(current.occurredAt),
  );
  if (recentFailures.length >= 5) {
    score += RISK_WEIGHTS.repeated_failures;
    reasons.push('repeated_failures');
  }

  return { riskScore: Math.min(score, 100), reasons };
}
