import { useEffect, useRef, useState } from 'react';
import {
  subscribeScanDiag,
  reportScanDiagKeydown,
  type ScanDiagState,
} from '../services/scanDiag';

/**
 * HUD d'observabilité douchette (v1.8.3) — panneau discret, coin bas-droit,
 * VISIBLE SANS DevTools sur la caisse packagée. Affiche en temps réel :
 *  - version de l'app (pour confirmer que la caisse tourne bien la bonne build) ;
 *  - écoute douchette attachée (oui/non) ;
 *  - compteur de touches keydown reçues au niveau window (le HUD installe LUI-MÊME
 *    ce compteur, purement observationnel — il ne bloque JAMAIS l'événement) ;
 *  - dernière touche + élément actif ;
 *  - dernier scan émis + nb de scans.
 *
 * Le compteur window est le signal décisif : s'il reste à 0 pendant un scan hors
 * focus, les touches n'atteignent pas le renderer (piste HID/pilote), et le
 * problème est hors de React.
 *
 * Repliable (clic sur l'en-tête). Additif, réversible, à retirer après validation.
 */
export function ScanDiagnosticHUD(): JSX.Element | null {
  const [s, setS] = useState<ScanDiagState | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const version = useRef<string>(
    (typeof window !== 'undefined' &&
      (window as unknown as { posDesktop?: { version?: string } }).posDesktop?.version) ||
      'web/dev',
  );

  // Compteur de touches window (capture, PASSIF — n'appelle jamais preventDefault
  // ni stopPropagation). Fiable même si l'écoute douchette avale l'événement au
  // niveau document : la phase de capture window précède celle du document, et
  // stopPropagation ne bloque pas les écouteurs déjà posés sur des nœuds antérieurs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as Element | null)?.tagName ?? 'BODY';
      reportScanDiagKeydown(e.key, tag);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  useEffect(() => subscribeScanDiag(setS), []);

  if (!s) return null;

  const box: React.CSSProperties = {
    position: 'fixed',
    right: 8,
    bottom: 8,
    zIndex: 2147483647,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 11,
    lineHeight: 1.35,
    color: '#e6e6f0',
    background: 'rgba(15,15,25,0.92)',
    border: '1px solid #3a3a55',
    borderRadius: 8,
    padding: collapsed ? '4px 8px' : '6px 10px',
    maxWidth: 260,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    pointerEvents: 'auto',
    userSelect: 'none',
  };
  const row = (label: string, value: string, warn = false): JSX.Element => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ color: '#9aa0b4' }}>{label}</span>
      <b style={{ color: warn ? '#ff6b6b' : '#e6e6f0' }}>{value}</b>
    </div>
  );

  return (
    <div style={box}>
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{ cursor: 'pointer', fontWeight: 700, color: '#ffd166', marginBottom: collapsed ? 0 : 4 }}
        title="Cliquer pour replier/déplier — F12 ouvre DevTools"
      >
        🔎 SCAN-DIAG v{version.current} {collapsed ? '▸' : '▾'}
      </div>
      {!collapsed && (
        <>
          {row('écoute attachée', s.attached ? 'OUI' : 'NON', !s.attached)}
          {row('keydown reçus', String(s.keydownCount), s.keydownCount === 0)}
          {row('dernière touche', s.lastKey ? JSON.stringify(s.lastKey) : '—')}
          {row('élément actif', s.lastActive || '—')}
          {row('scans émis', String(s.scanCount), s.scanCount === 0)}
          {row('dernier scan', s.lastScan || '—')}
        </>
      )}
    </div>
  );
}
