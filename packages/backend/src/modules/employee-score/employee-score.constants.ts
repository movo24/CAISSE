/**
 * Employee System Score — configuration 100 % factuelle.
 *
 * Le score n'est JAMAIS subjectif : il est alimenté uniquement par des
 * événements POS probants (session, comptage caisse, annulation, remboursement,
 * tiroir, remise, produit inconnu, correction stock, planning). Chaque règle
 * associe un type d'événement à une catégorie, un poids (points_delta) et une
 * sévérité. Les seuils/poids sont surchargeables en base (employee_score_rules)
 * mais ces valeurs servent de défaut versionné.
 */

/** Version des règles par défaut — historisée sur chaque score calculé. */
export const SCORE_RULES_VERSION = 1;

/** Catégories de score et leur poids maximum (total = 100). */
export const SCORE_CATEGORIES = {
  session: { label: 'Responsabilité caisse / session', max: 25 },
  cash: { label: 'Écart caisse / comptage', max: 25 },
  procedure: { label: 'Procédures sensibles', max: 20 },
  inventory: { label: 'Stock / inventaire', max: 10 },
  schedule: { label: 'Planning / présence session', max: 10 },
  regularity: { label: 'Régularité / récidive', max: 10 },
} as const;

export type ScoreCategory = keyof typeof SCORE_CATEGORIES;

export type ScoreSeverity = 'info' | 'minor' | 'major' | 'critical';

/** Tous les types d'événements probants (mission §5, A→I). */
export const SCORE_EVENT_TYPES = [
  // A — Session / responsabilité caisse
  'SESSION_OPENED',
  'SESSION_CLOSED',
  'SESSION_LOCKED',
  'SESSION_UNLOCKED',
  'SESSION_ABANDONED',
  'SESSION_FORCE_CLOSED_BY_MANAGER',
  'EMPLOYEE_SWITCHED',
  'ACTION_WITHOUT_VALID_SESSION',
  // B — Écart caisse / comptage espèces
  'CASH_COUNT_STARTED',
  'CASH_COUNT_COMPLETED',
  'CASH_COUNT_SKIPPED',
  'CASH_DIFFERENCE_MINOR',
  'CASH_DIFFERENCE_MAJOR',
  'CASH_DIFFERENCE_CRITICAL',
  // C — Annulations ticket
  'SALE_VOIDED',
  'LINE_VOIDED',
  'VOID_WITH_REASON',
  'VOID_WITHOUT_REASON',
  'VOID_WITH_MANAGER_CODE',
  'VOID_RATE_ABNORMAL',
  // D — Remboursements
  'REFUND_CREATED',
  'REFUND_WITH_REASON',
  'REFUND_WITHOUT_REASON',
  'REFUND_WITH_MANAGER_CODE',
  'REFUND_RATE_ABNORMAL',
  // E — Ouverture tiroir-caisse
  'CASH_DRAWER_OPENED_BY_SALE',
  'CASH_DRAWER_OPENED_MANUALLY',
  'CASH_DRAWER_OPENED_WITH_MANAGER_CODE',
  'CASH_DRAWER_OPEN_RATE_ABNORMAL',
  // F — Remises / prix forcés
  'DISCOUNT_APPLIED',
  'DISCOUNT_WITH_MANAGER_CODE',
  'DISCOUNT_WITHOUT_AUTHORIZATION',
  'DISCOUNT_ABOVE_LIMIT',
  'PRICE_OVERRIDE_APPLIED',
  'PRICE_OVERRIDE_WITHOUT_REASON',
  // G — Produit inconnu / création produit
  'UNKNOWN_BARCODE_SCANNED',
  'PRODUCT_CREATION_REQUESTED_FROM_POS',
  'PRODUCT_CREATED_FROM_DASHBOARD',
  'PRODUCT_DUPLICATE_ATTEMPT',
  'PRODUCT_DUPLICATE_BLOCKED',
  // H — Stock / inventaire
  'LOW_STOCK_ALERT_SHOWN',
  'LOW_STOCK_PHYSICAL_CHECK_DONE',
  'LOW_STOCK_IGNORED',
  'STOCK_CORRECTION_CREATED',
  'STOCK_CORRECTION_WITH_REASON',
  'STOCK_CORRECTION_WITHOUT_REASON',
  // I — Planning / TimeWin24
  'EMPLOYEE_LOGIN_ON_SCHEDULE',
  'EMPLOYEE_LOGIN_OUTSIDE_SCHEDULE',
  'EMPLOYEE_LOGIN_AFTER_SHIFT_END',
  'EMPLOYEE_SESSION_OPEN_AFTER_SHIFT_END',
] as const;

export type ScoreEventType = (typeof SCORE_EVENT_TYPES)[number];

/**
 * Faits sensibles (argent / procédure) qui NE PEUVENT PAS légitimement se
 * produire hors d'une session caisse valide. Quand la caisse envoie l'un de ces
 * événements via `POST /employee-score/events`, le backend exige que le
 * `sessionId` posté corresponde à une session ACTIVE du terminal pour l'employé.
 * Sinon → l'événement est requalifié en `ACTION_WITHOUT_VALID_SESSION` (anomalie
 * technique) : on n'invente pas un score, on constate qu'une action sensible a
 * été jouée sans rattachement à une vraie session.
 *
 * Volontairement HORS de cette liste : les événements de cycle de vie de session
 * eux-mêmes (SESSION_*, EMPLOYEE_SWITCHED), les agrégats analytiques calculés
 * côté backend (*_RATE_ABNORMAL), les faits produit/stock (autoritatifs backend)
 * et les faits de planning (émis au login, avant toute session).
 */
export const SESSION_BOUND_EVENT_TYPES: ReadonlySet<ScoreEventType> = new Set<ScoreEventType>([
  // B — Comptage / écart caisse
  'CASH_COUNT_STARTED',
  'CASH_COUNT_COMPLETED',
  'CASH_DIFFERENCE_MINOR',
  'CASH_DIFFERENCE_MAJOR',
  'CASH_DIFFERENCE_CRITICAL',
  // C — Annulations ticket
  'SALE_VOIDED',
  'LINE_VOIDED',
  'VOID_WITH_REASON',
  'VOID_WITHOUT_REASON',
  'VOID_WITH_MANAGER_CODE',
  // D — Remboursements
  'REFUND_CREATED',
  'REFUND_WITH_REASON',
  'REFUND_WITHOUT_REASON',
  'REFUND_WITH_MANAGER_CODE',
  // E — Tiroir-caisse
  'CASH_DRAWER_OPENED_BY_SALE',
  'CASH_DRAWER_OPENED_MANUALLY',
  'CASH_DRAWER_OPENED_WITH_MANAGER_CODE',
  // F — Remises / prix forcés
  'DISCOUNT_APPLIED',
  'DISCOUNT_WITH_MANAGER_CODE',
  'DISCOUNT_WITHOUT_AUTHORIZATION',
  'DISCOUNT_ABOVE_LIMIT',
  'PRICE_OVERRIDE_APPLIED',
  'PRICE_OVERRIDE_WITHOUT_REASON',
]);

/** Vrai si ce type de fait exige une session caisse valide côté serveur. */
export function requiresValidSession(eventType: string): boolean {
  return SESSION_BOUND_EVENT_TYPES.has(eventType as ScoreEventType);
}

export interface ScoreRule {
  category: ScoreCategory;
  /** Points appliqués au score (négatif = pénalité, 0 = neutre, positif = mérite). */
  pointsDelta: number;
  severity: ScoreSeverity;
  /** Plafond de pénalité cumulée par jour pour ce type (0 = pas de plafond). */
  maxDailyPenalty: number;
  /** Déclenche une alerte manager. */
  alert: boolean;
  label: string;
}

/**
 * Règles par défaut V1. Événements neutres/positifs = 0 (une action légitime ne
 * doit jamais pénaliser). Les pénalités reflètent des faits objectifs de
 * non-respect de procédure ou d'écart, jamais une opinion.
 */
export const DEFAULT_SCORE_RULES: Record<ScoreEventType, ScoreRule> = {
  // A — Session
  SESSION_OPENED: { category: 'session', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Session ouverte' },
  SESSION_CLOSED: { category: 'session', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Session fermée correctement' },
  SESSION_LOCKED: { category: 'session', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Caisse verrouillée (inactivité)' },
  SESSION_UNLOCKED: { category: 'session', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Caisse déverrouillée' },
  SESSION_ABANDONED: { category: 'session', pointsDelta: -8, severity: 'major', maxDailyPenalty: 16, alert: true, label: 'Session non fermée / abandonnée' },
  SESSION_FORCE_CLOSED_BY_MANAGER: { category: 'session', pointsDelta: -12, severity: 'critical', maxDailyPenalty: 24, alert: true, label: 'Session oubliée fermée par un responsable' },
  EMPLOYEE_SWITCHED: { category: 'session', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Changement de caissier (propre)' },
  ACTION_WITHOUT_VALID_SESSION: { category: 'session', pointsDelta: -15, severity: 'critical', maxDailyPenalty: 0, alert: true, label: 'Action sans session valide (anomalie technique)' },
  // B — Écart caisse
  CASH_COUNT_STARTED: { category: 'cash', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Comptage caisse démarré' },
  CASH_COUNT_COMPLETED: { category: 'cash', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Comptage caisse terminé' },
  CASH_COUNT_SKIPPED: { category: 'cash', pointsDelta: -4, severity: 'minor', maxDailyPenalty: 12, alert: true, label: 'Fermeture sans comptage (motivée)' },
  CASH_DIFFERENCE_MINOR: { category: 'cash', pointsDelta: -3, severity: 'minor', maxDailyPenalty: 9, alert: false, label: 'Écart caisse mineur' },
  CASH_DIFFERENCE_MAJOR: { category: 'cash', pointsDelta: -10, severity: 'major', maxDailyPenalty: 20, alert: true, label: 'Écart caisse majeur' },
  CASH_DIFFERENCE_CRITICAL: { category: 'cash', pointsDelta: -20, severity: 'critical', maxDailyPenalty: 0, alert: true, label: 'Écart caisse critique' },
  // C — Annulations
  SALE_VOIDED: { category: 'procedure', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Ticket annulé' },
  LINE_VOIDED: { category: 'procedure', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Ligne annulée' },
  VOID_WITH_REASON: { category: 'procedure', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Annulation avec motif' },
  VOID_WITHOUT_REASON: { category: 'procedure', pointsDelta: -4, severity: 'minor', maxDailyPenalty: 12, alert: false, label: 'Annulation sans motif' },
  VOID_WITH_MANAGER_CODE: { category: 'procedure', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Annulation validée par un responsable' },
  VOID_RATE_ABNORMAL: { category: 'procedure', pointsDelta: -8, severity: 'major', maxDailyPenalty: 16, alert: true, label: "Taux d'annulation anormal" },
  // D — Remboursements
  REFUND_CREATED: { category: 'procedure', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Remboursement créé' },
  REFUND_WITH_REASON: { category: 'procedure', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Remboursement avec motif' },
  REFUND_WITHOUT_REASON: { category: 'procedure', pointsDelta: -5, severity: 'minor', maxDailyPenalty: 15, alert: false, label: 'Remboursement sans motif' },
  REFUND_WITH_MANAGER_CODE: { category: 'procedure', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Remboursement validé par un responsable' },
  REFUND_RATE_ABNORMAL: { category: 'procedure', pointsDelta: -8, severity: 'major', maxDailyPenalty: 16, alert: true, label: 'Taux de remboursement anormal' },
  // E — Tiroir
  CASH_DRAWER_OPENED_BY_SALE: { category: 'procedure', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Tiroir ouvert par une vente espèces' },
  CASH_DRAWER_OPENED_MANUALLY: { category: 'procedure', pointsDelta: -2, severity: 'minor', maxDailyPenalty: 10, alert: false, label: 'Ouverture tiroir manuelle' },
  CASH_DRAWER_OPENED_WITH_MANAGER_CODE: { category: 'procedure', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Ouverture tiroir validée par un responsable' },
  CASH_DRAWER_OPEN_RATE_ABNORMAL: { category: 'procedure', pointsDelta: -6, severity: 'major', maxDailyPenalty: 12, alert: true, label: "Taux d'ouverture tiroir anormal" },
  // F — Remises / prix forcés
  DISCOUNT_APPLIED: { category: 'procedure', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Remise appliquée' },
  DISCOUNT_WITH_MANAGER_CODE: { category: 'procedure', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Remise validée par un responsable' },
  DISCOUNT_WITHOUT_AUTHORIZATION: { category: 'procedure', pointsDelta: -8, severity: 'major', maxDailyPenalty: 16, alert: true, label: 'Remise sans autorisation' },
  DISCOUNT_ABOVE_LIMIT: { category: 'procedure', pointsDelta: -12, severity: 'critical', maxDailyPenalty: 0, alert: true, label: 'Remise au-dessus du plafond (30 %)' },
  PRICE_OVERRIDE_APPLIED: { category: 'procedure', pointsDelta: -2, severity: 'minor', maxDailyPenalty: 8, alert: false, label: 'Prix forcé appliqué' },
  PRICE_OVERRIDE_WITHOUT_REASON: { category: 'procedure', pointsDelta: -6, severity: 'major', maxDailyPenalty: 12, alert: true, label: 'Prix forcé sans motif' },
  // G — Produit inconnu
  UNKNOWN_BARCODE_SCANNED: { category: 'inventory', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Code-barres inconnu scanné' },
  PRODUCT_CREATION_REQUESTED_FROM_POS: { category: 'inventory', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: "Demande d'intégration produit (propre)" },
  PRODUCT_CREATED_FROM_DASHBOARD: { category: 'inventory', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Produit créé depuis le Dashboard' },
  PRODUCT_DUPLICATE_ATTEMPT: { category: 'inventory', pointsDelta: -3, severity: 'minor', maxDailyPenalty: 9, alert: false, label: 'Tentative de doublon produit' },
  PRODUCT_DUPLICATE_BLOCKED: { category: 'inventory', pointsDelta: -5, severity: 'major', maxDailyPenalty: 10, alert: true, label: 'Doublon produit bloqué' },
  // H — Stock
  LOW_STOCK_ALERT_SHOWN: { category: 'inventory', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Alerte stock bas affichée' },
  LOW_STOCK_PHYSICAL_CHECK_DONE: { category: 'inventory', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Vérification physique faite' },
  LOW_STOCK_IGNORED: { category: 'inventory', pointsDelta: -3, severity: 'minor', maxDailyPenalty: 9, alert: false, label: 'Alerte stock ignorée' },
  STOCK_CORRECTION_CREATED: { category: 'inventory', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Correction stock créée' },
  STOCK_CORRECTION_WITH_REASON: { category: 'inventory', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Correction stock avec motif' },
  STOCK_CORRECTION_WITHOUT_REASON: { category: 'inventory', pointsDelta: -4, severity: 'major', maxDailyPenalty: 8, alert: true, label: 'Correction stock sans motif' },
  // I — Planning
  EMPLOYEE_LOGIN_ON_SCHEDULE: { category: 'schedule', pointsDelta: 0, severity: 'info', maxDailyPenalty: 0, alert: false, label: 'Connexion dans le planning' },
  EMPLOYEE_LOGIN_OUTSIDE_SCHEDULE: { category: 'schedule', pointsDelta: -2, severity: 'minor', maxDailyPenalty: 6, alert: true, label: 'Connexion hors planning (autorisée, alertée)' },
  EMPLOYEE_LOGIN_AFTER_SHIFT_END: { category: 'schedule', pointsDelta: -3, severity: 'minor', maxDailyPenalty: 6, alert: true, label: 'Connexion après fin de shift' },
  EMPLOYEE_SESSION_OPEN_AFTER_SHIFT_END: { category: 'schedule', pointsDelta: -4, severity: 'major', maxDailyPenalty: 8, alert: true, label: 'Session ouverte après fin de shift' },
};

/** Score total de départ (parfait). Les événements ne font que retrancher. */
export const SCORE_BASELINE = 100;

export type ScoreColor = 'green' | 'orange' | 'red' | 'red_critical';

/** Bandes de couleur (mission §4). */
export function scoreColor(total: number): ScoreColor {
  if (total >= 85) return 'green';
  if (total >= 70) return 'orange';
  if (total >= 50) return 'red';
  return 'red_critical';
}

/** Emoji associé (affichage POS). */
export function scoreColorEmoji(total: number): string {
  const c = scoreColor(total);
  return c === 'green' ? '🟢' : c === 'orange' ? '🟠' : '🔴';
}

/** Seuils d'écart caisse (centimes) — surchargeables par env, jamais codés en dur ailleurs. */
export function cashDifferenceThresholds() {
  return {
    minor: parseInt(process.env.CASH_DIFF_MINOR_CENTIMES || '500', 10), // 5,00 €
    major: parseInt(process.env.CASH_DIFF_MAJOR_CENTIMES || '2000', 10), // 20,00 €
    critical: parseInt(process.env.CASH_DIFF_CRITICAL_CENTIMES || '5000', 10), // 50,00 €
  };
}

/** Classe un écart caisse (valeur absolue en centimes) en type d'événement. */
export function classifyCashDifference(diffCentimes: number): ScoreEventType | null {
  const abs = Math.abs(diffCentimes);
  const t = cashDifferenceThresholds();
  if (abs >= t.critical) return 'CASH_DIFFERENCE_CRITICAL';
  if (abs >= t.major) return 'CASH_DIFFERENCE_MAJOR';
  if (abs >= t.minor) return 'CASH_DIFFERENCE_MINOR';
  return null; // écart négligeable → neutre
}
