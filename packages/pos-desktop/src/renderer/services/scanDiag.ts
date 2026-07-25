/**
 * Observabilité douchette (v1.8.3) — état partagé, minuscule, sans dépendance.
 *
 * Objectif TERRAIN : rendre la caisse packagée observable SANS DevTools. Le HUD
 * (ScanDiagnosticHUD) affiche cet état à l'écran ; POSPage y publie l'attache de
 * l'écoute et chaque scan émis ; le HUD y ajoute lui-même un COMPTEUR de touches
 * `keydown` reçues au niveau `window` (purement observationnel, jamais bloquant).
 *
 * Lecture du diagnostic sur la caisse :
 *  - keydown = 0 pendant un scan hors focus → les touches n'atteignent pas le
 *    renderer = piste HID/pilote/focus OS (hors React) ;
 *  - keydown incrémente mais « dernier scan » ne bouge pas → décodage/gate ;
 *  - « dernier scan » bouge mais rien au panier → résolution produit (aval).
 *
 * Additif, réversible, à retirer une fois le scanner validé sur la caisse.
 */
export interface ScanDiagState {
  /** L'écoute douchette globale est-elle attachée (écran de vente monté) ? */
  attached: boolean;
  /** Nb total de keydown vus au niveau window (capture, observationnel). */
  keydownCount: number;
  /** Dernière touche brute reçue (window). */
  lastKey: string;
  /** tagName de l'élément actif au moment de la dernière touche. */
  lastActive: string;
  /** Dernier code-barres ÉMIS par le décodeur (scan reconnu). */
  lastScan: string;
  /** Nb total de scans émis depuis le montage. */
  scanCount: number;
}

const state: ScanDiagState = {
  attached: false,
  keydownCount: 0,
  lastKey: '',
  lastActive: '',
  lastScan: '',
  scanCount: 0,
};

type Listener = (s: ScanDiagState) => void;
const listeners = new Set<Listener>();

function emit(): void {
  const snapshot = { ...state };
  for (const l of listeners) l(snapshot);
}

export function subscribeScanDiag(l: Listener): () => void {
  listeners.add(l);
  l({ ...state });
  return () => {
    listeners.delete(l);
  };
}

export function getScanDiag(): ScanDiagState {
  return { ...state };
}

export function setScanDiagAttached(attached: boolean): void {
  state.attached = attached;
  emit();
}

export function reportScanDiagKeydown(key: string, activeTag: string): void {
  state.keydownCount += 1;
  state.lastKey = key;
  state.lastActive = activeTag;
  emit();
}

export function reportScanDiagScan(code: string): void {
  state.lastScan = code;
  state.scanCount += 1;
  emit();
}
