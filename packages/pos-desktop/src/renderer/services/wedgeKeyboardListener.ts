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
        return;
      case 'scan':
        e.preventDefault();
        e.stopPropagation();
        cleanupLeadChar(); // retire le 1er caractère éventuellement écrit dans un champ
        onBarcode({ code: r.code, format: r.format });
        return;
      default:
        // 'none' (Entrée humaine, touche non imprimable) : rompt la séquence.
        leadEl = null;
    }
  };

  doc.addEventListener('keydown', handler, { capture: true });
  return () => doc.removeEventListener('keydown', handler, { capture: true });
}
