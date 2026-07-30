import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { readSessionTestBypassConfig } from '../../services/sessionTestBypass';

/**
 * Bandeau PERMANENT du MODE TEST (règle 5).
 *
 * Quand le contournement de verrou de session est activé par variable d'env
 * (`POS_SESSION_TEST_BYPASS`), la caisse encaisse malgré l'absence de session
 * vérifiée. L'owner exige alors un bandeau permanent, impossible à masquer, qui
 * dit sans ambiguïté que la session de caisse N'EST PAS vérifiée — pour que
 * personne ne confonde ces ventes de test avec l'exploitation réelle.
 *
 * S'affiche UNIQUEMENT quand le mode test est activé au niveau du shell (env).
 * Hors mode test → rien (comportement normal, règle 8). Volontairement NON
 * fermable : c'est un garde-fou, pas une notification.
 */
export function SessionTestBypassBanner() {
  const cfg = readSessionTestBypassConfig();
  if (!cfg.enabled) return null;

  return (
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-center text-sm font-extrabold uppercase tracking-wide text-black shadow-md"
    >
      <AlertTriangle size={16} className="shrink-0" />
      <span>MODE TEST — SESSION DE CAISSE NON VÉRIFIÉE</span>
    </div>
  );
}
