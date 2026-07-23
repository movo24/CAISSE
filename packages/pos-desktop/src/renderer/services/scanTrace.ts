/**
 * Traces horodatées de la chaîne de SCAN :
 * `douchette → décodeur → gate → recherche locale/backend → résultat visible`.
 *
 * Objectif terrain : prouver, sur la caisse, qu'un code est réellement reçu et
 * suivi d'un résultat À L'ÉCRAN — « aucun scan ne finit dans le silence ».
 * Chaque événement est émis en `console.info('[SCAN-TRACE]' …)` et conservé
 * (50 derniers) en localStorage pour lecture après coup. Purement passif :
 * ne throw jamais, n'influe jamais sur la vente ni sur le scan.
 */

export interface ScanTraceEvent {
  /** Horodatage epoch ms. */
  t: number;
  /** Étape : scan_detected / ignored_gate / ignored_duplicate / lookup_local_hit
   *  / lookup_backend / result_found / result_unknown / result_invalid /
   *  result_error … */
  step: string;
  /** Code concerné (tronqué à 40 caractères). */
  code?: string;
  meta?: Record<string, unknown>;
}

const STORAGE_KEY = 'pos_scan_trace';
const MAX_EVENTS = 50;

function load(): ScanTraceEvent[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let events: ScanTraceEvent[] = load();

export function scanTrace(step: string, code?: string, meta?: Record<string, unknown>): void {
  try {
    const evt: ScanTraceEvent = {
      t: Date.now(),
      step,
      ...(code ? { code: code.slice(0, 40) } : {}),
      ...(meta ? { meta } : {}),
    };
    events.unshift(evt);
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch {
      /* stockage indisponible → trace mémoire seulement */
    }
    // eslint-disable-next-line no-console
    console.info('[SCAN-TRACE]', step, code ?? '', meta ?? '');
  } catch {
    /* la trace ne casse jamais le scan */
  }
}

/** Événements du plus récent au plus ancien (diagnostic). */
export function listScanTrace(): ScanTraceEvent[] {
  return [...events];
}

/** Réinitialisation (tests). */
export function resetScanTrace(): void {
  events = [];
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
