import { barcodeFormat, isEditableTarget } from './wedgeDecoder';

/**
 * Écoute clavier globale de la douchette « keyboard wedge » (Lenvii E655).
 *
 * Une douchette USB agit comme un CLAVIER. Pour garantir qu'AUCUN caractère de
 * scan ne touche jamais le champ actif — même transitoirement, même face à une
 * sélection — on N'UTILISE PAS le « passthrough puis nettoyage » (qui remplaçait
 * une sélection sans pouvoir la restaurer). On applique un modèle
 * BUFFER-AVANT-INSERTION :
 *
 *  - chaque touche imprimable est AVALÉE en phase de capture (preventDefault +
 *    stopPropagation) → elle n'atteint JAMAIS le champ directement ;
 *  - elle est mise en BUFFER, avec un instantané (élément + sélection) capturé au
 *    moment de la frappe ;
 *  - si la séquence s'avère être un SCAN (2ᵉ touche rapide ≤ maxInterKeyMs, puis
 *    Entrée), le buffer est émis comme code-barres et RIEN n'est jamais inséré →
 *    `value`, `selectionStart`, `selectionEnd` du champ restent STRICTEMENT intacts ;
 *  - si la séquence s'avère être une FRAPPE HUMAINE (2ᵉ touche lente, silence, ou
 *    terminateur sans rafale), le caractère bufferisé est RESTITUÉ à l'identique,
 *    exactement à la sélection capturée (remplace la sélection comme une vraie
 *    frappe) → la saisie manuelle fonctionne normalement, sans corruption ;
 *  - l'Entrée terminant un scan est AVALÉE (aucun submit/paiement parasite) ;
 *  - les raccourcis Ctrl/Meta/Alt ne sont jamais interceptés (le buffer humain
 *    éventuel est d'abord restitué).
 *
 * Coût honnête : la 1ʳᵉ touche d'une frappe humaine est restituée après ~holdMs
 * (le temps de lever l'ambiguïté scan/humain). C'est le compromis explicite pour
 * une garantie de non-corruption totale, sans préfixe matériel.
 */
export interface WedgeBarcode {
  code: string;
  format: string;
}

export interface WedgeListenerOptions {
  /** Nombre minimal de caractères avant qu'un Entrée compte comme un scan. */
  minLength?: number;
  /** Écart max (ms) entre deux touches d'un même scan ; au-delà → frappe humaine. */
  maxInterKeyMs?: number;
  /** Délai (ms) avant de restituer une 1ʳᵉ touche isolée comme frappe humaine. */
  holdMs?: number;
  /** Silence (ms) fermant une rafale sans suffixe. */
  flushMs?: number;
  /** Compat : ancien conteneur d'options de décodeur (minLength/maxInterKeyMs). */
  decoder?: { minLength?: number; maxInterKeyMs?: number };
  /** Horloge injectable (tests). Par défaut Date.now. */
  now?: () => number;
}

interface FieldSnapshot {
  el: HTMLInputElement | HTMLTextAreaElement;
  start: number;
  end: number;
}

export function attachWedgeKeyboardListener(
  doc: Document,
  onBarcode: (b: WedgeBarcode) => void,
  options: WedgeListenerOptions = {},
): () => void {
  const minLength = options.minLength ?? options.decoder?.minLength ?? 4;
  const maxInterKeyMs = options.maxInterKeyMs ?? options.decoder?.maxInterKeyMs ?? 50;
  const holdMs = options.holdMs ?? Math.max(maxInterKeyMs + 20, 70);
  const flushMs = options.flushMs ?? 120;
  const now = options.now ?? (() => Date.now());

  // Buffer des touches AVALÉES en attente de verdict (scan vs humain).
  let buffer = '';
  // Instantané du champ+sélection capturé au DÉBUT du buffer courant (pour restitution).
  let snap: FieldSnapshot | null = null;
  let lastTs = 0;
  let burst = false; // une 2ᵉ touche rapide a confirmé une rafale (scan)
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  };

  const resetBuffer = () => {
    buffer = '';
    snap = null;
    lastTs = 0;
    burst = false;
    clearTimers();
  };

  /** Restitue le buffer courant dans le champ capturé (frappe humaine). */
  const replayHuman = () => {
    const text = buffer;
    const s = snap;
    resetBuffer();
    if (!text || !s) return;
    // Insère `text` à la sélection capturée (remplace la sélection le cas échéant),
    // exactement comme l'aurait fait la frappe réelle, puis resynchronise React.
    if (typeof s.el.setRangeText === 'function') {
      s.el.setRangeText(text, s.start, s.end, 'end');
      s.el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  /** Émet le buffer courant comme code-barres (scan) — RIEN n'est inséré. */
  const emitScan = () => {
    const code = buffer;
    resetBuffer();
    onBarcode({ code, format: barcodeFormat(code) });
  };

  const captureSnapshot = (): FieldSnapshot | null => {
    const active = doc.activeElement as
      | (Element & { tagName?: string; isContentEditable?: boolean })
      | null;
    if (
      isEditableTarget(active) &&
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
    ) {
      return {
        el: active,
        start: active.selectionStart ?? active.value.length,
        end: active.selectionEnd ?? active.value.length,
      };
    }
    return null;
  };

  const armHoldTimer = () => {
    if (holdTimer) clearTimeout(holdTimer);
    // Une 1ʳᵉ touche restée seule au-delà de holdMs = frappe humaine → restitution.
    holdTimer = setTimeout(() => { holdTimer = null; replayHuman(); }, holdMs);
  };

  const armFlushTimer = () => {
    if (flushTimer) clearTimeout(flushTimer);
    // Rafale sans suffixe : après un silence, on clôt. Assez long → scan ; sinon humain.
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (burst && buffer.length >= minLength) emitScan();
      else replayHuman();
    }, flushMs);
  };

  const handler = (e: KeyboardEvent) => {
    // Raccourcis : jamais interceptés. Un buffer humain en attente est d'abord restitué.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if (buffer) replayHuman();
      return;
    }

    const key = e.key;

    // Terminateur de scan (Enter/Tab/CR).
    if (key === 'Enter' || key === 'Tab' || key === '\r') {
      if (burst && buffer.length >= minLength) {
        // Fin d'un scan : on avale l'Entrée et on émet le code — rien n'est inséré.
        e.preventDefault();
        e.stopPropagation();
        emitScan();
      } else if (buffer) {
        // Entrée humaine après un ou des caractères bufferisés : on restitue le
        // texte, puis on laisse l'Entrée agir normalement (submit/validation).
        replayHuman();
      }
      // Sinon Entrée « nue » humaine : laissée au champ/formulaire.
      return;
    }

    // Touche imprimable.
    if (key.length === 1) {
      const t = now();

      if (buffer === '') {
        // Début d'une séquence : on AVALE et on bufferise (jamais inséré).
        e.preventDefault();
        e.stopPropagation();
        buffer = key;
        snap = captureSnapshot();
        lastTs = t;
        burst = false;
        armHoldTimer();
        return;
      }

      const gap = t - lastTs;
      if (gap <= maxInterKeyMs) {
        // Assez rapide → rafale (scan) : on continue d'avaler, rien n'est inséré.
        e.preventDefault();
        e.stopPropagation();
        buffer += key;
        lastTs = t;
        burst = true;
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        armFlushTimer();
        return;
      }

      // Trop lent → la séquence bufferisée était HUMAINE : on la restitue, puis on
      // repart avec la touche courante (elle aussi avalée + bufferisée).
      replayHuman();
      e.preventDefault();
      e.stopPropagation();
      buffer = key;
      snap = captureSnapshot();
      lastTs = t;
      burst = false;
      armHoldTimer();
      return;
    }

    // Touche non imprimable (navigation, F-keys, modificateurs seuls) : rompt la
    // séquence. Un buffer humain en attente est restitué ; la touche passe.
    if (buffer) replayHuman();
  };

  doc.addEventListener('keydown', handler, { capture: true });
  return () => {
    resetBuffer();
    doc.removeEventListener('keydown', handler, { capture: true });
  };
}
