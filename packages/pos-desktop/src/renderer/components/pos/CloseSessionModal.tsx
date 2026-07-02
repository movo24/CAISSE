import React, { useEffect, useMemo, useState } from 'react';
import { Lock, X, AlertTriangle } from 'lucide-react';
import { posSessionsApi } from '../../services/api';
import { computeCashCount, parseCountedEuros, CashSummary } from '../../lib/cash-count';

/**
 * P325 (cycle J) — Clôture de caisse (POS-017b).
 * Affiche le résumé de la session (ventes, espèces, total encaissé), demande le
 * fond de caisse et le comptage physique, calcule l'écart signé, puis clôt la
 * session. L'écart est AFFICHÉ et confirmé — jamais corrigé automatiquement
 * (l'humain assume le comptage ; la trace vit dans la session close + Z-report).
 */
interface Props {
  open: boolean;
  sessionId: string;
  onClose: () => void; // dismiss without closing the session
  onClosed: () => void; // session successfully closed
}

export function CloseSessionModal({ open, sessionId, onClose, onClosed }: Props): React.ReactElement | null {
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [floatEuros, setFloatEuros] = useState('0');
  const [countedEuros, setCountedEuros] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadError(null);
    posSessionsApi
      .cashSummary(sessionId)
      .then((res) => setSummary(res.data))
      .catch(() => setLoadError('Résumé de session indisponible (hors-ligne ?) — la clôture reste possible, sans comptage assisté.'));
  }, [open, sessionId]);

  const counted = parseCountedEuros(countedEuros);
  const float = parseCountedEuros(floatEuros) ?? 0;
  const result = useMemo(
    () => (summary && counted !== null ? computeCashCount(summary, float, counted) : null),
    [summary, counted, float],
  );

  if (!open) return null;

  const euros = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €';

  const doClose = async () => {
    try {
      setClosing(true);
      // P351 — le comptage saisi est PERSISTÉ : le serveur calcule et fige
      // l'écart signé (compté − fond − espèces session). Sans saisie, la
      // clôture reste possible (champs NULL, comportement historique).
      await posSessionsApi.close(sessionId, counted ?? undefined);
      onClosed();
    } catch (e: any) {
      setLoadError(e?.response?.data?.message ?? 'Échec de la clôture — réessayez.');
      setConfirming(false);
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2"><Lock className="w-5 h-5 text-indigo-600" /> Clôture de caisse</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        {loadError && (
          <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3 text-sm">
            <AlertTriangle className="w-4 h-4" /> {loadError}
          </div>
        )}

        {summary && (
          <div className="text-sm text-gray-600 mb-3 space-y-0.5">
            <div>Ventes de la session : <b>{summary.salesCount}</b></div>
            <div>Espèces encaissées : <b>{euros(summary.cashCapturedMinorUnits)}</b></div>
            <div>Total encaissé : <b>{euros(summary.totalCapturedMinorUnits)}</b></div>
          </div>
        )}

        <label className="block text-xs font-medium text-gray-500 mb-1">Fond de caisse (EUR)</label>
        <input
          type="number" step="0.01" min="0" value={floatEuros}
          onChange={(e) => { setFloatEuros(e.target.value); setConfirming(false); }}
          className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
        />
        <label className="block text-xs font-medium text-gray-500 mb-1">Espèces comptées (EUR)</label>
        <input
          autoFocus type="number" step="0.01" min="0" value={countedEuros} placeholder="ex. 152,50"
          onChange={(e) => { setCountedEuros(e.target.value); setConfirming(false); }}
          className="w-full border rounded-lg px-3 py-2 text-lg mb-3"
        />

        {result && (
          <div
            className={`rounded-lg p-2 mb-3 text-sm border ${
              result.status === 'exact'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            Attendu : <b>{euros(result.expectedMinorUnits)}</b> — Compté : <b>{euros(result.countedMinorUnits)}</b>
            <br />
            Écart : <b>{result.deltaMinorUnits > 0 ? '+' : ''}{euros(result.deltaMinorUnits)}</b> ({result.status})
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50 ml-auto">Annuler</button>
          {!confirming ? (
            <button
              disabled={summary !== null && counted === null}
              onClick={() => setConfirming(true)}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white disabled:opacity-40"
            >Clôturer…</button>
          ) : (
            <button
              disabled={closing}
              onClick={() => void doClose()}
              className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white disabled:opacity-40"
            >{closing ? 'Clôture…' : result && result.status !== 'exact' ? `Confirmer malgré l'écart` : 'Confirmer la clôture'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
