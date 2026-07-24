import { WedgeDecoder, isEditableTarget, type WedgeDecoderOptions } from './wedgeDecoder';

/**
 * Écoute clavier globale de la douchette « keyboard wedge » (Lenvii E655) — la
 * couche DOM au-dessus du décodeur pur.
 *
 * Une douchette USB agit comme un CLAVIER : « ignorer » un champ ne suffit pas, les
 * caractères y seraient écrits. On écoute donc en PHASE DE CAPTURE (avant le champ) :
 *  - rafale reconnue → chaque caractère est AVALÉ (preventDefault + stopPropagation)
 *    → il n'atteint jamais le champ ni les autres gestionnaires ;
 *  - l'Entrée terminant un scan est AVALÉE aussi → aucun submit/paiement/action parasite ;
 *  - le 1er caractère (indéterminable avant d'avoir un timing) est laissé passer, PUIS
 *    RETIRÉ du champ dès que le scan est identifié → **aucun caractère ne reste dans le champ** ;
 *  - la frappe humaine (lente) passe intacte → le clavier normal fonctionne partout ;
 *  - les raccourcis Ctrl/Meta/Alt ne sont jamais interceptés.
 */
export interface WedgeBarcode {
  code: string;
  format: string;
}

export interface WedgeListenerOptions {
  decoder?: WedgeDecoderOptions;
  /** Horloge injectable (tests). Par défaut Date.now. */
  now?: () => number;
}

export function attachWedgeKeyboardListener(
  doc: Document,
  onBarcode: (b: WedgeBarcode) => void,
  options: WedgeListenerOptions = {},
): () => void {
  const decoder = new WedgeDecoder(options.decoder);
  const now = options.now ?? (() => Date.now());
  // Champ ayant reçu le 1er caractère (passthrough) de la séquence en cours.
  let leadEl: HTMLInputElement | HTMLTextAreaElement | null = null;
  // Terminaison par SILENCE (douchette « sans suffixe ») : timer armé après
  // chaque caractère de rafale ; s'il expire sans nouvelle touche, la rafale
  // est close et émise comme scan — aucun scan ne meurt dans le buffer.
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const FLUSH_AFTER_MS = 120; // > maxInterKeyMs (50) → jamais de coupure en pleine rafale

  const clearFlushTimer = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  const armFlushTimer = () => {
    clearFlushTimer();
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const pending = decoder.flushPending(now());
      if (pending) {
        cleanupLeadChar();
        onBarcode({ code: pending.code, format: pending.format });
      }
    }, FLUSH_AFTER_MS);
  };

  const cleanupLeadChar = () => {
    const el = leadEl;
    leadEl = null;
    if (!el) return;
    const end = el.selectionStart ?? el.value.length;
    if (end > 0 && typeof el.setRangeText === 'function') {
      // Retire le seul caractère qui a pu être écrit (le 1er, juste avant le caret).
      el.setRangeText('', end - 1, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true })); // resync React (onChange)
    }
  };

  const handler = (e: KeyboardEvent) => {
    // Raccourcis : jamais interceptés.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const r = decoder.feed(e.key, now());
    switch (r.kind) {
      case 'passthrough': {
        // 1er caractère : laissé au champ, mais mémorisé pour un nettoyage si c'est un scan.
        const active = doc.activeElement;
        leadEl =
          isEditableTarget(active as { tagName?: string; isContentEditable?: boolean } | null) &&
          (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
            ? active
            : null;
        return;
      }
      case 'swallow':
        e.preventDefault();
        e.stopPropagation();
        // Rafale CONFIRMÉE dès ce 2e caractère : on retire le 1er caractère
        // (passthrough) IMMÉDIATEMENT, sans attendre l'Entrée. Le flash éventuel
        // dans la barre de recherche passe de ~la durée du code (~65 ms) à ~un
        // inter-caractère (~5 ms) → invisible. `cleanupLeadChar` est idempotent
        // (no-op si le 1er caractère a déjà été retiré).
        if (leadEl) cleanupLeadChar();
        armFlushTimer(); // rafale en cours → si plus rien n'arrive, clore et émettre
        return;
      case 'scan':
        e.preventDefault();
        e.stopPropagation();
        clearFlushTimer();
        cleanupLeadChar(); // retire le 1er caractère éventuellement écrit dans un champ
        onBarcode({ code: r.code, format: r.format });
        return;
      default:
        // 'none' (Entrée/Tab humain, touche non imprimable) : rompt la séquence.
        clearFlushTimer();
        leadEl = null;
    }
  };

  doc.addEventListener('keydown', handler, { capture: true });
  return () => {
    clearFlushTimer();
    doc.removeEventListener('keydown', handler, { capture: true });
  };
}
