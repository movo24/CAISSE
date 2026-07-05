/**
 * Customer Display — state machine (pure, unit-testable).
 *
 * Derives the single screen state from a snapshot of inputs. The display is
 * strictly read-only: this machine never mutates cart/payment; it only decides
 * what to *show*. Payment states are ephemeral and owned by the display's local
 * controller (which manages the success/failed timers), so they are passed in
 * as an already-resolved `payment` value rather than re-derived here.
 */

export type DisplayState =
  | 'off'
  | 'idle'
  | 'cart_active'
  | 'payment_pending'
  | 'payment_success'
  | 'payment_failed'
  | 'error_fallback';

export type PaymentPhase = 'none' | 'pending' | 'success' | 'failed';

export interface DisplayMachineInput {
  /** Master switch from settings (customer_display_enabled). */
  enabled: boolean;
  /** Blackout requested from the dashboard (customer_display_blackout). */
  blackout: boolean;
  /** Sync lost after having been connected (stale data → neutral screen). */
  connectionLost: boolean;
  /** Number of line items currently in the mirrored cart. */
  itemCount: number;
  /** Current ephemeral payment phase, resolved by the display controller. */
  payment: PaymentPhase;
}

/**
 * Priority (highest first):
 *  1. off             — disabled or blackout always wins (hard cut).
 *  2. payment_success — let the "Merci" screen complete even if sync blips.
 *  3. payment_pending — "présentez votre carte".
 *  4. payment_failed  — neutral retry message.
 *  5. error_fallback  — stale/lost sync → neutral "écran en attente".
 *  6. cart_active     — items present.
 *  7. idle            — default (video / branding).
 */
export function deriveDisplayState(input: DisplayMachineInput): DisplayState {
  if (!input.enabled || input.blackout) return 'off';
  if (input.payment === 'success') return 'payment_success';
  if (input.payment === 'pending') return 'payment_pending';
  if (input.payment === 'failed') return 'payment_failed';
  if (input.connectionLost) return 'error_fallback';
  if (input.itemCount > 0) return 'cart_active';
  return 'idle';
}

/** States in which the live ticket (items + total) is visible to the customer. */
export function showsTicket(state: DisplayState): boolean {
  return state === 'cart_active' || state === 'payment_pending';
}

/** States in which the idle media (video / branding) should play. */
export function showsIdleMedia(state: DisplayState): boolean {
  return state === 'idle';
}
