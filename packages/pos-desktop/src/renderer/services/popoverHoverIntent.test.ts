/**
 * Intention de survol du popover « Sous-effectif » — badge + panneau = 1 zone.
 * Timer injecté → scénarios déterministes (owner 2026-07-24).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PopoverHoverIntent } from './popoverHoverIntent';

/** Faux ordonnanceur : exécute les timers à la demande (contrôle déterministe). */
function fakeScheduler() {
  const timers = new Map<number, () => void>();
  let id = 0;
  return {
    schedule: (fn: () => void, _ms: number) => {
      const h = ++id;
      timers.set(h, fn);
      return h;
    },
    cancel: (h: unknown) => timers.delete(h as number),
    /** Déclenche tous les timers en attente (simule l'écoulement du délai). */
    flush: () => {
      for (const fn of [...timers.values()]) fn();
      timers.clear();
    },
    pendingCount: () => timers.size,
  };
}

describe('PopoverHoverIntent', () => {
  let sched: ReturnType<typeof fakeScheduler>;
  let closed: number;
  let intent: PopoverHoverIntent;

  beforeEach(() => {
    sched = fakeScheduler();
    closed = 0;
    intent = new PopoverHoverIntent({
      schedule: sched.schedule,
      cancel: sched.cancel,
      onClose: () => { closed += 1; },
    });
  });

  it('scénario 4 — sortie complète souris → fermeture après le délai', () => {
    intent.handlePointerLeave('mouse');
    expect(intent.isClosePending()).toBe(true);
    expect(closed).toBe(0); // pas encore : délai de grâce
    sched.flush();
    expect(closed).toBe(1);
  });

  it('scénario 3 — trajet badge → panneau : une ré-entrée annule la fermeture (aucune fermeture intermédiaire)', () => {
    intent.handlePointerLeave('mouse'); // quitte le badge (entre dans le pont/gap)
    expect(intent.isClosePending()).toBe(true);
    intent.handlePointerEnter('mouse'); // entre dans le panneau
    expect(intent.isClosePending()).toBe(false);
    sched.flush();
    expect(closed).toBe(0); // JAMAIS fermé pendant le trajet
  });

  it('scénario 5 — retour rapide avant expiration → temporisation annulée', () => {
    intent.handlePointerLeave('mouse');
    intent.handlePointerEnter('mouse'); // revient avant le flush
    sched.flush();
    expect(closed).toBe(0);
    expect(sched.pendingCount()).toBe(0);
  });

  it('scénario 2 — souris maintenue sur la zone (enter sans leave) → reste ouvert', () => {
    intent.handlePointerEnter('mouse');
    sched.flush();
    expect(closed).toBe(0);
  });

  it('tactile — pointerLeave tactile NE programme PAS de fermeture (tap-extérieur s’en charge)', () => {
    intent.handlePointerLeave('touch');
    expect(intent.isClosePending()).toBe(false);
    sched.flush();
    expect(closed).toBe(0);
  });

  it('une nouvelle sortie remplace le timer précédent (pas d’empilement)', () => {
    intent.handlePointerLeave('mouse');
    intent.handlePointerLeave('mouse'); // 2ᵉ sortie
    expect(sched.pendingCount()).toBe(1); // un seul timer actif
    sched.flush();
    expect(closed).toBe(1); // une seule fermeture
  });

  it('dispose() annule un timer en attente (démontage → pas de fermeture fantôme)', () => {
    intent.handlePointerLeave('mouse');
    intent.dispose();
    sched.flush();
    expect(closed).toBe(0);
  });
});
