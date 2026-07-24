/**
 * Intention de survol d'un popover « badge + panneau = UNE seule zone » — logique
 * PURE (aucun DOM), testable de façon déterministe (timer injectable).
 *
 * Comportement (owner, 2026-07-24, fenêtre « Sous-effectif ») :
 *  - le popover reste ouvert tant que la souris est sur le badge OU le panneau ;
 *  - quand elle quitte COMPLÈTEMENT la zone, fermeture après une COURTE
 *    temporisation ANNULÉE si la souris re-rentre (évite la fermeture pendant le
 *    trajet badge → panneau ; pas de clignotement) ;
 *  - hover réservé à la SOURIS : sur écran tactile (`pointerType !== 'mouse'`),
 *    aucune fermeture par survol — l'ouverture se fait au toucher et la
 *    fermeture au toucher extérieur (géré séparément par les écouteurs dismiss).
 *
 * Le composant fournit `schedule`/`cancel` (setTimeout/clearTimeout réels) et
 * reçoit `onClose()` quand la temporisation expire sans ré-entrée.
 */

export interface HoverIntentOptions {
  /** Délai de grâce avant fermeture après sortie souris (ms). Défaut 160. */
  closeDelayMs?: number;
  /** Programme un timer, renvoie un handle. */
  schedule: (fn: () => void, ms: number) => unknown;
  /** Annule un timer programmé. */
  cancel: (handle: unknown) => void;
  /** Appelé quand la zone doit se fermer (temporisation écoulée sans ré-entrée). */
  onClose: () => void;
}

export class PopoverHoverIntent {
  private readonly closeDelayMs: number;
  private readonly schedule: HoverIntentOptions['schedule'];
  private readonly cancel: HoverIntentOptions['cancel'];
  private readonly onClose: () => void;
  private pending: unknown = null;

  constructor(opts: HoverIntentOptions) {
    this.closeDelayMs = opts.closeDelayMs ?? 160;
    this.schedule = opts.schedule;
    this.cancel = opts.cancel;
    this.onClose = opts.onClose;
  }

  /** La souris entre sur le badge OU le panneau → annule toute fermeture en cours. */
  handlePointerEnter(pointerType: string): void {
    if (pointerType !== 'mouse') return; // tactile/stylet : pas de logique de survol
    this.clearPending();
  }

  /**
   * La souris quitte l'élément englobant (badge + panneau + pont) → programme la
   * fermeture différée. Une ré-entrée (handlePointerEnter) l'annule.
   */
  handlePointerLeave(pointerType: string): void {
    if (pointerType !== 'mouse') return;
    this.clearPending();
    this.pending = this.schedule(() => {
      this.pending = null;
      this.onClose();
    }, this.closeDelayMs);
  }

  /** Une fermeture est-elle programmée (utile aux tests/diagnostic) ? */
  isClosePending(): boolean {
    return this.pending !== null;
  }

  /** Nettoyage (démontage) : annule un timer éventuel. */
  dispose(): void {
    this.clearPending();
  }

  private clearPending(): void {
    if (this.pending !== null) {
      this.cancel(this.pending);
      this.pending = null;
    }
  }
}
