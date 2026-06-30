import React, { useState, useEffect, useCallback } from 'react';
import { Activity, RefreshCw, PackageX, Loader2, AlertCircle, Send, Clock, Download } from 'lucide-react';
import { integrationApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useCurrentStoreId } from '../hooks/useCurrentStoreId';

interface OutboxStats {
  total?: number;
  pending?: number;
  published?: number;
  failed?: number;
  backlog?: number;
  byType?: Record<string, number>;
}
interface StockSignal {
  productId: string; productName: string | null; lastQuantity: number;
  lowStockThreshold: number | null; status: 'ok' | 'low' | 'depleted';
}
interface StockSignalsResult { products: StockSignal[]; lowCount: number; depletedCount: number }

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function IntegrationSupervisionPage() {
  const storeId = useCurrentStoreId();
  const role = useAuthStore((s) => s.employee?.role);
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [stats, setStats] = useState<OutboxStats | null>(null);
  const [signals, setSignals] = useState<StockSignalsResult | null>(null);
  const [recon, setRecon] = useState<any | null>(null);
  const [shifts, setShifts] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relayMsg, setRelayMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true); setError(null); setRelayMsg(null);
    try {
      const [s, sig, rec, sh] = await Promise.allSettled([
        integrationApi.outboxStats(),
        integrationApi.stockSignals({ date }),
        integrationApi.reconciliation(),
        integrationApi.shifts({ date }),
      ]);
      if (s.status === 'fulfilled') setStats(s.value.data); else setStats(null);
      if (sig.status === 'fulfilled') setSignals(sig.value.data); else setSignals(null);
      if (rec.status === 'fulfilled') setRecon(rec.value.data); else setRecon(null);
      if (sh.status === 'fulfilled') setShifts(sh.value.data); else setShifts(null);
      if (s.status === 'rejected' && sig.status === 'rejected' && rec.status === 'rejected') {
        setError('Aucune donnée de supervision disponible.');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erreur lors du chargement.');
    } finally {
      setLoading(false);
    }
  }, [storeId, date]);

  useEffect(() => { load(); }, [load]);

  const runRelay = async () => {
    setRelayMsg(null); setError(null);
    try {
      const res = await integrationApi.relay(200);
      const n = res.data?.published ?? res.data?.relayed ?? res.data?.count ?? 0;
      setRelayMsg(`Relais lancé — ${n} évènement(s) traité(s).`);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Échec du relais.');
    }
  };

  const exportShiftsCsv = async () => {
    setError(null);
    try {
      const res = await integrationApi.shifts({ date, format: 'csv' });
      downloadCsv(`amplitude_poste_${date}.csv`, typeof res.data === 'string' ? res.data : '');
    } catch (err: any) {
      setError(err?.response?.data?.message || "Erreur lors de l'export CSV.");
    }
  };

  const statusBadge = (st: string) =>
    st === 'depleted' ? 'bg-red-100 text-red-700' : st === 'low' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Activity className="w-7 h-7 text-indigo-600" />
        <h1 className="text-2xl font-bold">Supervision intégration</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
        <button onClick={load} className="px-3 py-2 text-sm rounded-lg border hover:bg-gray-50 inline-flex items-center gap-1"><RefreshCw className="w-4 h-4" /> Actualiser</button>
        {role === 'admin' && (
          <button onClick={runRelay} className="px-3 py-2 text-sm rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-50 inline-flex items-center gap-1"><Send className="w-4 h-4" /> Lancer le relais</button>
        )}
      </div>

      {!storeId && <p className="text-amber-600 text-sm">Sélectionnez un magasin.</p>}
      {loading && <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /> Chargement…</div>}
      {error && <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-3"><AlertCircle className="w-5 h-5" /> {error}</div>}
      {relayMsg && <div className="text-green-700 bg-green-50 border border-green-200 rounded-lg p-3 mb-3">{relayMsg}</div>}

      {!loading && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Outbox backlog */}
          <div className="bg-white rounded-lg border p-4">
            <h2 className="font-semibold mb-2">File d'intégration (outbox)</h2>
            {stats ? (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><div className="text-2xl font-bold">{stats.pending ?? 0}</div><div className="text-xs text-gray-500">En attente</div></div>
                <div><div className="text-2xl font-bold text-green-600">{stats.published ?? 0}</div><div className="text-xs text-gray-500">Publiés</div></div>
                <div><div className={`text-2xl font-bold ${(stats.failed ?? 0) > 0 ? 'text-red-600' : ''}`}>{stats.failed ?? 0}</div><div className="text-xs text-gray-500">Échecs</div></div>
              </div>
            ) : <p className="text-gray-500 text-sm">Indisponible.</p>}
          </div>

          {/* Reconciliation */}
          <div className="bg-white rounded-lg border p-4">
            <h2 className="font-semibold mb-2">Rapprochement présence POS↔TimeWin</h2>
            {recon ? (
              <p className="text-sm text-gray-700">
                {recon.timewinReachable === false ? '⚠️ TimeWin injoignable (dégradé).' : 'TimeWin joignable.'}{' '}
                {Array.isArray(recon.matches) ? `${recon.matches.length} rapprochement(s).` : ''}
                {Array.isArray(recon.discrepancies) && recon.discrepancies.length > 0 && (
                  <span className="text-amber-600"> {recon.discrepancies.length} écart(s).</span>
                )}
              </p>
            ) : <p className="text-gray-500 text-sm">Indisponible.</p>}
          </div>

          {/* Stock signals */}
          <div className="bg-white rounded-lg border p-4 md:col-span-2">
            <h2 className="font-semibold mb-2 flex items-center gap-2">
              <PackageX className="w-5 h-5 text-amber-600" /> Signaux de stock (réappro)
              {signals && (
                <span className="text-xs text-gray-500">— {signals.depletedCount} rupture(s), {signals.lowCount} bas</span>
              )}
            </h2>
            {!signals || signals.products.length === 0 ? (
              <p className="text-gray-500 text-sm">Aucun signal de stock pour cette date.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left"><tr><th className="px-3 py-2">Produit</th><th className="px-3 py-2 text-right">Qté</th><th className="px-3 py-2 text-right">Seuil</th><th className="px-3 py-2">Statut</th></tr></thead>
                <tbody>
                  {signals.products.map((p) => (
                    <tr key={p.productId} className="border-t">
                      <td className="px-3 py-2">{p.productName || p.productId}</td>
                      <td className="px-3 py-2 text-right">{p.lastQuantity}</td>
                      <td className="px-3 py-2 text-right">{p.lowStockThreshold ?? '—'}</td>
                      <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs ${statusBadge(p.status)}`}>{p.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Amplitude de poste */}
          <div className="bg-white rounded-lg border p-4 md:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold flex items-center gap-2"><Clock className="w-5 h-5 text-indigo-600" /> Amplitude de poste</h2>
              <button onClick={exportShiftsCsv} className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 inline-flex items-center gap-1"><Download className="w-4 h-4" /> Export CSV</button>
            </div>
            {!shifts || !Array.isArray(shifts.byEmployee) || shifts.byEmployee.length === 0 ? (
              <p className="text-gray-500 text-sm">Aucun poste pour cette date.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left"><tr><th className="px-3 py-2">Employé</th><th className="px-3 py-2 text-right">Postes</th><th className="px-3 py-2 text-right">Minutes</th></tr></thead>
                <tbody>
                  {shifts.byEmployee.map((e: any) => (
                    <tr key={e.employeeId} className="border-t"><td className="px-3 py-2">{e.employeeId}</td><td className="px-3 py-2 text-right">{e.shiftCount}</td><td className="px-3 py-2 text-right">{e.totalMinutes}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
