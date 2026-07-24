/**
 * Écouteurs de fermeture d'un popover — pris depuis le DOCUMENT (aucun overlay
 * plein écran, qui casserait la détection de survol-sortie du conteneur).
 *
 * Ferme quand :
 *  - un pointeur (souris/tactile) appuie EN DEHORS du conteneur (clic/tap
 *    extérieur, y compris sur écran tactile) ;
 *  - la touche `Échap` est pressée.
 *
 * Retourne une fonction de nettoyage. `isOutside` est exporté pur (testable).
 */

/** La cible d'un évènement est-elle en dehors du conteneur (badge + panneau) ? */
export function isOutside(target: EventTarget | null, container: Element | null): boolean {
  if (!container) return true;
  if (!(target instanceof Node)) return true; // pas un nœud DOM → considéré extérieur
  return !container.contains(target);
}

export interface DismissHandlers {
  /** Appelé pour fermer le popover. */
  onDismiss: () => void;
}

/**
 * Attache les écouteurs de fermeture au `document`. À n'appeler que lorsque le
 * popover est ouvert ; la fonction de nettoyage les retire.
 * `pointerdown` couvre souris ET tactile (un seul évènement, avant le click →
 * pas de ré-ouverture parasite).
 */
export function attachDismissListeners(
  doc: Document,
  getContainer: () => Element | null,
  handlers: DismissHandlers,
): () => void {
  const onPointerDown = (e: Event) => {
    if (isOutside(e.target, getContainer())) handlers.onDismiss();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') handlers.onDismiss();
  };
  // `pointerdown` = souris + tactile + stylet. Repli `mousedown`/`touchstart`
  // inutile (PointerEvents supportés par Chromium/Electron).
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('keydown', onKeyDown, true);
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('keydown', onKeyDown, true);
  };
}
