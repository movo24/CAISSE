/**
 * Traces horodatées de la chaîne post-validation :
 * `validation → réponse backend → ticket → spooler → impression → tiroir`.
 *
 * Objectif terrain : mesurer la durée RÉELLE de chaque étape sur la caisse
 * (latence anormale constatée sur la Star TSP143) et journaliser l'ouverture
 * du tiroir (vente, caisse, employé, heure, résultat) SANS dépendre du réseau.
 *
 * - Chaque vente (`saleId` = clé d'idempotence) possède sa liste de jalons
 *   `{ step, t, meta }` ; les durées sont dérivées, jamais stockées.
 * - Persisté en localStorage (25 dernières ventes) → lisible depuis l'écran
 *   diagnostic même après redémarrage de la caisse.
 * - Aussi émis en `console.info('[PRINT-TRACE]' …)` pour capture terrain.
 * - Purement passif : ne throw jamais, n'influe JAMAIS sur la vente.
 */

export interface TraceMark {
  step: string;
  /** Horodatage epoch ms. */
  t: number;
  meta?: Record<string, unknown>;
}

export interface SaleTrace {
  saleId: string;
  startedAt: number;
  marks: TraceMark[];
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'pos_print_chain_traces';
const MAX_SALES = 25;
const MAX_MARKS_PER_SALE = 60;

function defaultStore(): KeyValueStore | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* indisponible (tests/SSR) */
  }
  return null;
}

export class PrintChainTrace {
  private traces: SaleTrace[] = []; // plus récent en tête
  private readonly store: KeyValueStore | null;

  constructor(store?: KeyValueStore | null) {
    this.store = store === undefined ? defaultStore() : store;
    this.load();
  }

  private load(): void {
    if (!this.store) return;
    try {
      const raw = this.store.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.traces = parsed.filter(
          (t): t is SaleTrace => t && typeof t.saleId === 'string' && Array.isArray(t.marks),
        );
      }
    } catch {
      this.traces = [];
    }
  }

  private persist(): void {
    if (!this.store) return;
    try {
      this.store.setItem(STORAGE_KEY, JSON.stringify(this.traces.slice(0, MAX_SALES)));
    } catch {
      /* stockage plein/indisponible → trace mémoire seulement */
    }
  }

  /**
   * Enregistre un jalon. `at` permet de dater un événement survenu AVANT que
   * l'identité de la vente soit connue (ex. clic « Valider » avant création de
   * la clé d'idempotence).
   */
  mark(saleId: string, step: string, meta?: Record<string, unknown>, at?: number): void {
    if (!saleId || !step) return;
    try {
      const t = typeof at === 'number' ? at : Date.now();
      let trace = this.traces.find((x) => x.saleId === saleId);
      if (!trace) {
        trace = { saleId, startedAt: t, marks: [] };
        this.traces.unshift(trace);
        if (this.traces.length > MAX_SALES) this.traces.length = MAX_SALES;
      }
      if (trace.marks.length < MAX_MARKS_PER_SALE) {
        trace.marks.push({ step, t, ...(meta ? { meta } : {}) });
      }
      this.persist();
      // eslint-disable-next-line no-console
      console.info('[PRINT-TRACE]', saleId, step, `+${t - trace.startedAt}ms`, meta ?? '');
    } catch {
      /* la trace ne casse JAMAIS la vente */
    }
  }

  getTrace(saleId: string): SaleTrace | null {
    return this.traces.find((x) => x.saleId === saleId) ?? null;
  }

  /** Trace la plus récente (dernière vente instrumentée). */
  latest(): SaleTrace | null {
    return this.traces[0] ?? null;
  }

  /** Toutes les traces, plus récentes d'abord. */
  list(): SaleTrace[] {
    return [...this.traces];
  }

  /**
   * Durées dérivées d'une trace : pour chaque jalon, temps écoulé depuis le
   * début (`atMs`) et depuis le jalon précédent (`sincePrevMs`).
   */
  durations(saleId: string): Array<{ step: string; atMs: number; sincePrevMs: number; meta?: Record<string, unknown> }> {
    const trace = this.getTrace(saleId);
    if (!trace) return [];
    const sorted = [...trace.marks].sort((a, b) => a.t - b.t);
    return sorted.map((m, i) => ({
      step: m.step,
      atMs: m.t - trace.startedAt,
      sincePrevMs: i === 0 ? 0 : m.t - sorted[i - 1].t,
      ...(m.meta ? { meta: m.meta } : {}),
    }));
  }
}

/** Singleton caisse (module scope) — survit aux re-renders, persisté. */
export const printChainTrace = new PrintChainTrace();
