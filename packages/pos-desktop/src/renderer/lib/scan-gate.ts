/**
 * P355 — POS-037 (scanner) : cœur PUR de la détection, extrait de
 * useScannerZXing.handleDetection SANS changement de comportement.
 * Testable sans caméra ni ZXing (l'API caméra reste un test physique).
 *
 * Deux responsabilités :
 *  - `cleanScanCode`   : normalisation du code brut (trim + suppression des
 *    caractères non imprimables ASCII — les douchettes ajoutent CR/LF/GS) et
 *    rejet des codes trop courts (< 3) ;
 *  - `shouldAcceptScan`: garde anti-rebond — pendant le cooldown, seul un code
 *    DIFFÉRENT du précédent passe, et uniquement en mode continu (l'inventaire
 *    scanne des codes variés à la chaîne ; la caisse, elle, re-scanne souvent
 *    le même article → bloqué pendant le cooldown pour éviter le double ajout).
 */

/** Reproduit exactement `code.trim().replace(/[^\x20-\x7E]/g, '')` + `length >= 3`. */
export function cleanScanCode(raw: string): string | null {
  const clean = raw.trim().replace(/[^\x20-\x7E]/g, '');
  return clean.length >= 3 ? clean : null;
}

export interface ScanGateState {
  /** Cooldown en cours (fenêtre anti-rebond active). */
  cooldownActive: boolean;
  /** Mode continu (inventaire) vs mono-scan (caisse). */
  continuous: boolean;
  /** Dernier code accepté pendant la fenêtre. */
  lastCode: string;
}

/** Reproduit exactement la condition du hook :
 *  `if (cooldown) { if (!continuous || code === lastCode) return; }` */
export function shouldAcceptScan(cleanCode: string, state: ScanGateState): boolean {
  if (!state.cooldownActive) return true;
  return state.continuous && cleanCode !== state.lastCode;
}
