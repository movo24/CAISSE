// ── AlertsPage ───────────────────────────────────────────────────
// P362 — POS-110 : cockpit supervision LECTURE SEULE (manager/admin).
// Toute la logique vit dans utils/alerts-view.ts (pur, testé 8/8) ;
// ce composant ne fait que fetch + rendu. Aucune action possible.
// Erreurs JAMAIS avalées (S5) : bandeau + bouton réessayer.
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, ShieldAlert, AlertTriangle, CheckCircle2, PackageX, Activity,
} from 'lucide-react';
import { cockpitApi } from '../services/api';
import {
  safeAlertsPayload,
  overallBadge,
  sortAnomalies,
  alertSections,
  AlertsPayloadVM,
} from '../utils/alerts-view';

const TONE_STYLES: Record<string, string> = {
  ok: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
};

export function AlertsPage() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<AlertsPayloadVM | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cockpitApi.alerts();
      setPayload(safeAlertsPayload(res.data));
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Impossible de charger les alertes. Réessayez.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const badge = payload ? overallBadge(payload.summary.overall) : null;
  const sections = payload ? alertSections(payload) : [];
  const anomalies = payload ? sortAnomalies(payload.anomalies) : [];

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/')} aria-label="Retour" className="p-2 -ml-2 rounded-xl active:bg-gray-100">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <div className="text-base font-bold">Supervision</div>
          <div className="text-xs text-gray-400">Lecture seule — aucune action possible ici</div>
        </div>
        <button onClick={load} aria-label="Rafraîchir" className="p-2 rounded-xl active:bg-gray-100" disabled={loading}>
          <RefreshCw size={18} className={loading ? 'animate-spin text-gray-300' : 'text-gray-500'} />
        </button>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {error && (
          <div data-testid="alerts-error" className="p-3 rounded-xl bg-red-50 text-red-600 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={load} className="font-semibold underline ml-3">Réessayer</button>
          </div>
        )}

        {loading && !payload && (
          <p className="text-center text-gray-400 py-10">Chargement…</p>
        )}

        {payload && badge && (
          <>
            {/* Badge global */}
            <div className={`p-4 rounded-2xl flex items-center gap-3 ${TONE_STYLES[badge.tone]}`}>
              {badge.tone === 'ok' ? <CheckCircle2 size={22} /> : badge.tone === 'warning' ? <AlertTriangle size={22} /> : <ShieldAlert size={22} />}
              <div>
                <div className="font-bold">{badge.label}</div>
                <div className="text-xs opacity-80">
                  {payload.summary.stockCriticalCount} critique(s) · {payload.summary.stockAlertCount} stock bas · {payload.summary.anomaliesOpenCount} anomalie(s)
                </div>
              </div>
            </div>

            {sections.length === 0 && !error && (
              <p className="text-center text-gray-400 py-8">Aucune alerte — rien à signaler.</p>
            )}

            {sections.map((section) => (
              <div key={section.key} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-4 py-2.5 flex items-center justify-between border-b border-gray-50">
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {section.key === 'anomalies' ? <Activity size={16} /> : <PackageX size={16} />}
                    {section.title}
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TONE_STYLES[section.tone]}`}>{section.count}</span>
                </div>

                {section.key === 'anomalies' ? (
                  <ul>
                    {anomalies.map((a) => (
                      <li key={a.id} className="px-4 py-2.5 border-b border-gray-50 last:border-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{a.message}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TONE_STYLES[a.severity === 'info' ? 'ok' : a.severity]}`}>
                            {a.severity}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400">{a.code} · {new Date(a.createdAt).toLocaleString('fr-FR')}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul>
                    {(section.key === 'stock-critical' ? payload.stock.critical : payload.stock.alert).map((p) => (
                      <li key={p.id} className="px-4 py-2.5 border-b border-gray-50 last:border-0 flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">{p.name}</div>
                          <div className="text-xs text-gray-400">{p.ean}</div>
                        </div>
                        <span className={`text-sm font-bold ${p.level === 'critical' ? 'text-red-600' : 'text-amber-600'}`}>
                          {p.stockQuantity}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
