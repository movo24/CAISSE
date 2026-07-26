// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ScanDiagnosticHUD,
  SCAN_DIAG_FLAG,
  readScanDiagVisible,
} from './ScanDiagnosticHUD';

// Test PUREMENT VISUEL : on prouve que l'encart est masqué par défaut (caissier)
// et affiché seulement en mode diagnostic. Rien ici ne touche à la capture du
// scanner (attachée au document, hors de ce composant).

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  localStorage.clear();
});

function renderHud(): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(ScanDiagnosticHUD));
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('readScanDiagVisible — option développeur', () => {
  it('faux par défaut (aucun flag) → invisible pour le caissier', () => {
    localStorage.clear();
    expect(readScanDiagVisible()).toBe(false);
  });
  it('vrai uniquement quand le flag vaut exactement "1"', () => {
    localStorage.setItem(SCAN_DIAG_FLAG, '1');
    expect(readScanDiagVisible()).toBe(true);
    localStorage.setItem(SCAN_DIAG_FLAG, '0');
    expect(readScanDiagVisible()).toBe(false);
    localStorage.setItem(SCAN_DIAG_FLAG, 'true');
    expect(readScanDiagVisible()).toBe(false);
  });
});

describe('ScanDiagnosticHUD — rendu conditionné', () => {
  it('n’affiche RIEN par défaut (utilisation caissier normale)', () => {
    localStorage.clear();
    const { container, unmount } = renderHud();
    expect(container.textContent).not.toContain('SCAN-DIAG');
    expect(container.querySelector('div')).toBeNull();
    unmount();
  });

  it('affiche l’encart quand le mode diagnostic est activé (flag)', () => {
    localStorage.setItem(SCAN_DIAG_FLAG, '1');
    const { container, unmount } = renderHud();
    expect(container.textContent).toContain('SCAN-DIAG');
    unmount();
  });

  it('bascule avec le raccourci réservé Ctrl+Alt+Shift+D et le persiste', () => {
    localStorage.clear();
    const { container, unmount } = renderHud();
    expect(container.textContent).not.toContain('SCAN-DIAG');
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'D', ctrlKey: true, altKey: true, shiftKey: true }),
      );
    });
    expect(container.textContent).toContain('SCAN-DIAG');
    expect(localStorage.getItem(SCAN_DIAG_FLAG)).toBe('1');
    unmount();
  });

  it('une frappe douchette ordinaire (sans modificateurs) ne révèle PAS l’encart', () => {
    localStorage.clear();
    const { container, unmount } = renderHud();
    act(() => {
      // Simule une rafale douchette : caractères + Entrée, aucun modificateur.
      for (const key of ['0', '1', '2', 'D', 'Enter']) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key }));
      }
    });
    expect(container.textContent).not.toContain('SCAN-DIAG');
    unmount();
  });
});
