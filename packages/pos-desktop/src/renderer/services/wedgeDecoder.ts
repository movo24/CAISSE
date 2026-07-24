/**
 * Décodeur « keyboard wedge » PUR (testable sans DOM).
 *
 * La douchette USB Lenvii E655 se comporte comme un CLAVIER : elle « tape » les
 * caractères du code très vite puis envoie `Entrée`. On distingue un SCAN d'une
 * frappe humaine par la VITESSE (écart entre touches).
 *
 * ⚠️ Point clé (corrige un faux-sens antérieur) : « ignorer » un événement quand un
 * champ a le focus ne l'empêche PAS d'être écrit dans le champ — une douchette USB
 * agit comme un clavier. Pour empêcher la pollution d'un champ, l'appelant écoute en
 * PHASE DE CAPTURE et **avale** (`preventDefault`) les touches d'une rafale reconnue.
 * Ce décodeur renvoie donc, pour chaque touche, l'action que l'appelant doit prendre :
 *   - `passthrough` : laisser la touche atteindre le champ (frappe humaine, ou 1er
 *      caractère d'une séquence — indéterminable avant d'avoir un timing) ;
 *   - `swallow`     : touche d'une rafale reconnue → l'appelant fait preventDefault ;
 *   - `scan`        : `Entrée` terminant un scan → preventDefault + router vers le panier ;
 *   - `none`        : touche hors périmètre (Entrée humaine, touche non imprimable).
 *
 * Limite honnête : sans préfixe configuré sur la douchette, le 1er caractère d'un
 * scan ne peut pas être distingué d'une frappe humaine et reste en `passthrough`.
 * Un préfixe (configurable sur l'E655) le rendrait déterministe (zéro fuite).
 */
export interface WedgeDecoderOptions {
  /** Nombre minimal de caractères avant qu'un `Entrée` compte comme un scan. */
  minLength?: number;
  /** Écart max (ms) entre deux touches d'un même scan ; au-delà → frappe humaine. */
  maxInterKeyMs?: number;
}

export type WedgeFeed =
  | { kind: 'none' }
  | { kind: 'passthrough' }
  | { kind: 'swallow' }
  | { kind: 'scan'; code: string; format: string };

/** Format déclaratif d'après la longueur (EAN-8/13, UPC-A, GTIN-14, sinon CODE-128). */
export function barcodeFormat(code: string): string {
  switch (code.length) {
    case 8:
      return 'EAN-8';
    case 12:
      return 'UPC-A';
    case 13:
      return 'EAN-13';
    case 14:
      return 'GTIN-14';
    default:
      return 'CODE-128';
  }
}

/**
 * Cible d'événement « éditable » (champ de saisie). Utilitaire pur (sans DOM) — sert
 * à l'appelant pour ne se soucier de la pollution que lorsqu'un champ peut recevoir
 * la frappe.
 */
export function isEditableTarget(
  el: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export class WedgeDecoder {
  private buffer = '';
  private lastTs = 0;
  private burst = false;
  private readonly minLength: number;
  private readonly maxInterKeyMs: number;

  constructor(opts: WedgeDecoderOptions = {}) {
    this.minLength = opts.minLength ?? 4;
    this.maxInterKeyMs = opts.maxInterKeyMs ?? 50;
  }

  /** Réinitialise l'état interne. */
  reset(): void {
    this.buffer = '';
    this.lastTs = 0;
    this.burst = false;
  }

  /**
   * Consomme une touche imprimable ou un TERMINATEUR de scan. `now` = horodatage ms.
   * Terminateurs reconnus : `Enter` (couvre NumpadEnter — même `key`), `Tab` et le
   * retour chariot `\r` — les trois suffixes configurables sur les douchettes
   * usuelles (Lenvii E655 incluse). Un terminateur sans rafale = frappe humaine.
   * L'appelant NE doit PAS passer les combinaisons avec Ctrl/Meta/Alt (raccourcis).
   */
  feed(key: string, now: number): WedgeFeed {
    if (key === 'Enter' || key === 'Tab' || key === '\r') {
      const code = this.buffer;
      const wasBurst = this.burst;
      this.reset();
      if (wasBurst && code.length >= this.minLength) {
        return { kind: 'scan', code, format: barcodeFormat(code) };
      }
      // Entrée/Tab « humain » (aucune rafale) → laissé au champ/formulaire.
      return { kind: 'none' };
    }

    if (key.length === 1) {
      if (this.lastTs === 0) {
        // 1er caractère : timing inconnu → on laisse au champ (passthrough).
        this.buffer = key;
        this.lastTs = now;
        this.burst = false;
        return { kind: 'passthrough' };
      }
      const gap = now - this.lastTs;
      if (gap <= this.maxInterKeyMs) {
        // Assez rapide → rafale (scan) → l'appelant avale ce caractère.
        this.buffer += key;
        this.lastTs = now;
        this.burst = true;
        return { kind: 'swallow' };
      }
      // Trop lent → frappe humaine : on repart avec ce caractère, laissé au champ.
      this.buffer = key;
      this.lastTs = now;
      this.burst = false;
      return { kind: 'passthrough' };
    }

    // Touches non imprimables (modificateurs, navigation, F-keys…) : hors périmètre.
    return { kind: 'none' };
  }

  /**
   * Terminaison par SILENCE (douchette configurée « sans suffixe ») : si une
   * rafale est en cours et qu'aucune touche n'est arrivée depuis plus de
   * `maxInterKeyMs`, la rafale est close et renvoyée comme scan. L'appelant
   * (couche DOM) appelle ceci depuis un timer armé après chaque `swallow`.
   * Renvoie null si rien à clore (pas de rafale, trop court, ou touche trop
   * récente — le timer a été devancé par une vraie touche).
   */
  flushPending(now: number): { code: string; format: string } | null {
    if (!this.burst) return null;
    if (now - this.lastTs <= this.maxInterKeyMs) return null;
    const code = this.buffer;
    this.reset();
    if (code.length >= this.minLength) return { code, format: barcodeFormat(code) };
    return null;
  }
}
