/**
 * Décodeur « keyboard wedge » PUR (testable sans DOM).
 *
 * La douchette USB Lenvii E655 (et assimilées) se comporte comme un CLAVIER :
 * elle « tape » les caractères du code très vite puis envoie `Entrée`. Ce
 * décodeur distingue un SCAN d'une saisie humaine par la **vitesse** : les
 * caractères d'un scan arrivent à quelques ms d'intervalle ; dès qu'un écart
 * dépasse `maxInterKeyMs`, le tampon est réinitialisé (frappe humaine) et ne
 * pourra jamais produire un faux scan.
 *
 * Le décodeur ne touche PAS au DOM : l'appelant (peripheralBridge) lui passe la
 * touche + un horodatage. Ceci le rend testable en reproduisant exactement la
 * séquence clavier de la douchette.
 */
export interface WedgeDecoderOptions {
  /** Nombre minimal de caractères avant qu'un `Entrée` compte comme un scan. */
  minLength?: number;
  /** Écart max (ms) entre deux touches d'un même scan ; au-delà → frappe humaine. */
  maxInterKeyMs?: number;
}

export interface DecodedBarcode {
  code: string;
  format: string;
}

/**
 * Cible d'événement « éditable » : un champ de saisie qui doit recevoir la frappe
 * lui-même. Quand la cible est éditable, la douchette globale NE capture PAS (le
 * scan n'est jamais injecté ailleurs, et le clavier normal fonctionne). Pur : prend
 * une forme minimale, pas de dépendance DOM.
 */
export function isEditableTarget(
  el: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

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

export class WedgeDecoder {
  private buffer = '';
  private lastTs = 0;
  private readonly minLength: number;
  private readonly maxInterKeyMs: number;

  constructor(opts: WedgeDecoderOptions = {}) {
    this.minLength = opts.minLength ?? 4;
    this.maxInterKeyMs = opts.maxInterKeyMs ?? 80;
  }

  /** Réinitialise le tampon (ex. focus passé dans un champ de saisie). */
  reset(): void {
    this.buffer = '';
    this.lastTs = 0;
  }

  /**
   * Consomme une touche. `now` = horodatage ms. Renvoie un code-barres UNIQUEMENT
   * sur `Entrée` terminant une séquence assez rapide d'au moins `minLength` caractères.
   */
  feed(key: string, now: number): DecodedBarcode | null {
    if (key === 'Enter') {
      const code = this.buffer;
      this.buffer = '';
      this.lastTs = 0;
      if (code.length >= this.minLength) return { code, format: barcodeFormat(code) };
      return null;
    }
    if (key.length === 1) {
      // Écart trop grand depuis la touche précédente → saisie humaine : on repart de zéro.
      if (this.lastTs !== 0 && now - this.lastTs > this.maxInterKeyMs) {
        this.buffer = '';
      }
      this.buffer += key;
      this.lastTs = now;
      return null;
    }
    // Touches de modification/navigation (Shift, Tab…) : ignorées, tampon conservé.
    return null;
  }
}
