// ── Proposition d'activation Passkey (après connexion centrale) ──
// Affichée UNE fois après une connexion réussie au compte central,
// si l'appareil supporte WebAuthn et qu'aucune clé n'existe encore.
// Activation strictement explicite (bouton), nom d'appareil éditable.
// « Plus tard » mémorise le refus localement (simple préférence UI —
// jamais une credential).
// ─────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { Fingerprint, Loader2 } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { webauthnApi } from '../services/api';
import {
  detectPasskeySupport,
  isUserCancellation,
  registerPasskey,
  suggestDeviceName,
  PasskeySupport,
} from '../lib/webauthn';

const DISMISS_KEY = 'wesley:passkeyPromptDismissed';

export function PasskeyPrompt() {
  const employee = useAuthStore((s) => s.employee);
  const [support, setSupport] = useState<PasskeySupport | null>(null);
  const [visible, setVisible] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!employee || localStorage.getItem(DISMISS_KEY) === '1') return;
      const sup = await detectPasskeySupport();
      if (!sup.available || cancelled) return;
      try {
        const { data } = await webauthnApi.credentials();
        const active = (data as any[]).filter((c) => !c.revokedAt);
        if (!cancelled && active.length === 0) {
          setSupport(sup);
          setDeviceName(suggestDeviceName(employee.firstName));
          setVisible(true);
        }
      } catch {
        /* offline / erreur : ne jamais bloquer l'entrée dans l'app */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employee]);

  if (!visible || !support) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey(deviceName.trim() || suggestDeviceName(employee?.firstName));
      setDone(true);
      setTimeout(() => setVisible(false), 2200);
    } catch (e: any) {
      if (isUserCancellation(e)) {
        setError('Activation annulée. Vous pourrez réessayer depuis « Mes appareils et clés d’accès ».');
      } else {
        setError(e?.response?.data?.message ?? e?.message ?? 'Activation impossible sur cet appareil.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={dismiss} />
      <div className="relative w-full bg-white rounded-t-3xl p-5 pb-8 animate-slide-up">
        <div className="w-10 h-1 bg-mobile-border rounded-full mx-auto mb-4" />
        {done ? (
          <p className="text-center text-sm font-semibold text-emerald-700 py-4">
            Clé d’accès activée — « {deviceName} » peut maintenant se connecter avec {support.label}.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-2xl bg-mobile-subtle flex items-center justify-center">
                <Fingerprint size={22} className="text-mobile-text" />
              </span>
              <div>
                <h2 className="text-sm font-bold">Activer {support.label === 'clé d’accès' ? 'une clé d’accès' : support.label} ou une clé d’accès</h2>
                <p className="text-[11px] text-mobile-muted">
                  Connexion plus rapide, gérée par votre appareil. Aucune donnée biométrique n’est transmise.
                </p>
              </div>
            </div>
            <label className="block mt-4 text-[11px] font-semibold text-mobile-muted">
              Nom de cet appareil
              <input
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                maxLength={100}
                className="mt-1 w-full min-h-[48px] px-4 rounded-2xl border border-mobile-border bg-mobile-subtle/60 text-sm text-mobile-text focus:outline-none focus:ring-2 focus:ring-violet-600/50"
              />
            </label>
            {error && (
              <p role="alert" className="mt-3 text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2.5">{error}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={dismiss}
                disabled={busy}
                className="flex-1 min-h-[48px] rounded-2xl bg-mobile-subtle text-sm font-bold text-mobile-text"
              >
                Plus tard
              </button>
              <button
                onClick={activate}
                disabled={busy}
                className="flex-1 min-h-[48px] rounded-2xl bg-mobile-text text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {busy && <Loader2 size={15} className="animate-spin" />}
                Activer
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
