import { useEffect, useState } from 'react';
import { BellOff } from 'lucide-react';
import { cockpitApi } from '../api';
import { validateQuietHours } from '../format';
import { getPushToken, PUSH_PLATFORM } from '../push-token';

/**
 * Réglages notifications. Les quiet hours sont une DONNÉE utilisateur (aucun
 * défaut imposé) ; la validation client reflète la règle serveur — le serveur
 * re-valide quoi qu'il arrive. L'enregistrement du device passe par le seam
 * push-token : tant que FCM n'est pas câblé, l'état « non configuré » s'affiche
 * et les alertes restent pleinement visibles dans l'onglet Alertes.
 */
export function SettingsView() {
  const [enabled, setEnabled] = useState(true);
  const [quietStart, setQuietStart] = useState<string>('');
  const [quietEnd, setQuietEnd] = useState<string>('');
  const [state, setState] = useState<'loading' | 'ready' | 'saving'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pushChecked, setPushChecked] = useState(false);

  useEffect(() => {
    cockpitApi
      .getPreferences()
      .then((p) => {
        setEnabled(p.enabled);
        setQuietStart(p.quietStartHour == null ? '' : String(p.quietStartHour));
        setQuietEnd(p.quietEndHour == null ? '' : String(p.quietEndHour));
      })
      .catch(() => setMessage('Préférences indisponibles.'))
      .finally(() => setState('ready'));
    getPushToken().then((t) => {
      setPushToken(t);
      setPushChecked(true);
    });
  }, []);

  const parseHour = (v: string): number | null => (v.trim() === '' ? null : Number(v));

  const save = async () => {
    const start = parseHour(quietStart);
    const end = parseHour(quietEnd);
    const invalid = validateQuietHours(start, end);
    if (invalid) {
      setMessage(invalid);
      return;
    }
    setState('saving');
    setMessage(null);
    try {
      await cockpitApi.setPreferences({ enabled, quietStartHour: start, quietEndHour: end });
      if (pushToken) await cockpitApi.registerDevice(pushToken, PUSH_PLATFORM);
      setMessage('Enregistré.');
    } catch {
      setMessage('Enregistrement impossible — réessaie.');
    } finally {
      setState('ready');
    }
  };

  if (state === 'loading') return <p className="p-4 text-sm text-mobile-muted">Chargement…</p>;

  return (
    <div className="p-4 space-y-3">
      <div className="bg-white rounded-xl border border-mobile-border/60 p-4 space-y-3">
        <label className="flex items-center justify-between text-sm font-semibold">
          Notifications d’alertes
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5" />
        </label>
        <div>
          <div className="text-[11px] text-mobile-muted mb-1">Heures silencieuses (les deux, ou aucune) — heures 0–23</div>
          <div className="flex items-center gap-2 text-sm">
            de
            <input
              inputMode="numeric"
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
              placeholder="—"
              className="w-14 border border-mobile-border/60 rounded-lg p-2 text-center"
            />
            h à
            <input
              inputMode="numeric"
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
              placeholder="—"
              className="w-14 border border-mobile-border/60 rounded-lg p-2 text-center"
            />
            h
          </div>
        </div>
        <button
          onClick={save}
          disabled={state === 'saving'}
          className="w-full bg-mobile-accent text-white rounded-lg py-2.5 font-semibold touch-target disabled:opacity-50"
        >
          {state === 'saving' ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {message && <p className="text-[12px] text-mobile-muted">{message}</p>}
      </div>

      <div className="bg-white rounded-xl border border-mobile-border/60 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BellOff size={16} className="text-mobile-muted" /> Push sur cet appareil
        </div>
        <p className="text-[12px] text-mobile-muted mt-1">
          {!pushChecked
            ? 'Vérification…'
            : pushToken
              ? 'Appareil prêt — enregistré à la sauvegarde.'
              : 'Push non configuré (fournisseur FCM à venir). Les alertes restent visibles dans l’onglet Alertes.'}
        </p>
      </div>
    </div>
  );
}
