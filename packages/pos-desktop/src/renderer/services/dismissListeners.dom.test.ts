// @vitest-environment jsdom
/**
 * Écouteurs de fermeture du popover (owner scénario 6) : clic/tap extérieur +
 * Échap ferment ; une interaction À L'INTÉRIEUR de la zone (badge + panneau) ne
 * ferme PAS.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachDismissListeners, isOutside } from './dismissListeners';

let zone: HTMLDivElement;
let panelChild: HTMLButtonElement;
let outside: HTMLDivElement;
let detach: () => void;
let onDismiss: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  zone = document.createElement('div'); // conteneur badge + panneau
  panelChild = document.createElement('button'); // élément du panneau
  zone.appendChild(panelChild);
  outside = document.createElement('div'); // ailleurs dans la page
  document.body.append(zone, outside);
  onDismiss = vi.fn();
  detach = attachDismissListeners(document, () => zone, { onDismiss });
});

afterEach(() => detach());

function pointerDown(el: Element) {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

describe('isOutside (pur)', () => {
  it('cible dans le conteneur → false ; hors conteneur → true', () => {
    expect(isOutside(panelChild, zone)).toBe(false);
    expect(isOutside(zone, zone)).toBe(false);
    expect(isOutside(outside, zone)).toBe(true);
  });
  it('conteneur absent → considéré extérieur', () => {
    expect(isOutside(panelChild, null)).toBe(true);
  });
});

describe('attachDismissListeners', () => {
  it('scénario 6 — clic/tap EXTÉRIEUR → ferme', () => {
    pointerDown(outside);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('interaction DANS la zone (badge/panneau) → NE ferme PAS', () => {
    pointerDown(panelChild);
    pointerDown(zone);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('scénario 6 — touche Échap → ferme', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('autre touche → ne ferme pas', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('après détachement, plus aucun écouteur actif', () => {
    detach();
    pointerDown(outside);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
