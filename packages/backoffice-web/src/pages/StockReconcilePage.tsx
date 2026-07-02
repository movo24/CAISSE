import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Scale, AlertTriangle } from 'lucide-react';
import { stockApi } from '../services/api';
import { safeErrorMessage } from '../utils/safeErrorMessage';
import {
  ReconRow,
  driftLevel,
  sortForDisplay,
  reconSummary,
} from '../lib/stock-reconcile-view';

/**
 * P322 (cycle I5) — Réconciliation stock (lecture seule).
 * Trois vues par produit : compteur opérationnel (products.stock_quantity),
 * net du journal de mouvements (depuis P306 — variation, PAS un stock absolu
 * sans backfill), balance legacy stock_locations + dérive vs compteur.
 */
export function StockReconcilePage(): React.ReactElement {
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [driftCount, setDriftCount] = useState(0);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await stockApi.reconcile();
      setRows(res.data?.rows ?? []);
      setDriftCount(res.data?.driftCount ?? 0);
      setGeneratedAt(res.data?.generatedAt ?? null);
      setError(null);
    } catch (err: any) {
      setError(safeErrorMessage(err, 'Erreur lors du chargement de la réconciliation'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const badge = (r: ReconRow) => {
    const lvl = driftLevel(r);
    if (lvl === 'drift')
      return <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">dérive {r.balanceDrift! > 0 ? '+' : ''}{r.balanceDrift}</span>;
    if (lvl === 'no-balance')
      return <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">pas de balance</span>;
    return <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700">aligné</span>;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Scale className="w-5 h-5 text-bo-accent" /> Réconciliation stock
        </h1>
        <button onClick={() => void load()} className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 flex items-center gap-1.5">
          <RefreshCw className="w-4 h-4" /> Rafraîchir
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Compteur opérationnel vs journal de mouvements (variation depuis l'activation P306) vs balance legacy.
        Lecture seule — aucune correction automatique.
      </p>

      {error && (
        <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className={`text-sm mb-3 ${driftCount > 0 ? 'text-red-700 font-medium' : 'text-gray-600'}`}>
            {reconSummary(rows, driftCount)}
            {generatedAt && <span className="text-gray-400"> · généré {new Date(generatedAt).toLocaleTimeString('fr-FR')}</span>}
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Produit</th>
                  <th className="px-3 py-2 text-right">Compteur</th>
                  <th className="px-3 py-2 text-right">Journal (net)</th>
                  <th className="px-3 py-2 text-right">Balance legacy</th>
                  <th className="px-3 py-2">État</th>
                </tr>
              </thead>
              <tbody>
                {sortForDisplay(rows).map((r) => (
                  <tr key={r.productId} className="border-t">
                    <td className="px-3 py-2">{r.productName}</td>
                    <td className="px-3 py-2 text-right font-medium">{r.counter}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{r.journalNet === null ? '—' : (r.journalNet > 0 ? `+${r.journalNet}` : r.journalNet)}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{r.balance ?? '—'}</td>
                    <td className="px-3 py-2">{badge(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {loading && <div className="text-sm text-gray-400">Chargement…</div>}
    </div>
  );
}
