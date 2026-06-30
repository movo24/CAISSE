import React, { useState } from 'react';
import { ClipboardList, Loader2, AlertCircle, Download } from 'lucide-react';
import { stockApi } from '../services/api';
import { useCurrentStoreId } from '../hooks/useCurrentStoreId';
import { parseCounts } from '../utils/parseCounts';

/** centimes → "12,34 €" */
function eur(minor: number): string {
  return (Number(minor || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

interface VLine { productId: string; name: string | null; ean: string | null; systemQty: number; countedQty: number; qtyDiff: number; valueDiffMinorUnits: number; status: 'ok' | 'overage' | 'shortage' }
interface VResult { lines: VLine[]; countedProducts: number; discrepancyCount: number; shortageValueMinorUnits: number; overageValueMinorUnits: number; netValueMinorUnits: number; unmatched: string[] }

function toCsv(r: VResult): string {
  const esc = (v: string | number) => { const s = String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = ['ean;produit;systeme;compte;ecart_qte;ecart_valeur_centimes;statut'];
  for (const l of r.lines) lines.push([esc(l.ean ?? ''), esc(l.name ?? ''), l.systemQty, l.countedQty, l.qtyDiff, l.valueDiffMinorUnits, l.status].join(';'));
  return lines.join('\n');
}

export function InventoryVariancePage() {
  const storeId = useCurrentStoreId();
  const [raw, setRaw] = useState('');
  const [result, setResult] = useState<VResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const counts = parseCounts(raw);
    if (counts.length === 0) { setError('Aucune ligne valide. Format attendu : EAN;quantité par ligne.'); return; }
    setLoading(true); setError(null);
    try {
      const res = await stockApi.variance(counts);
      setResult(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erreur lors du calcul de l’écart.');
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!result) return;
    const blob = new Blob([toCsv(result)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `ecart_inventaire_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const badge = (st: string) => st === 'shortage' ? 'bg-red-100 text-red-700' : st === 'overage' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <ClipboardList className="w-7 h-7 text-indigo-600" />
        <h1 className="text-2xl font-bold">Écart d'inventaire</h1>
      </div>

      {!storeId && <p className="text-amber-600 text-sm mb-3">Sélectionnez un magasin.</p>}

      <p className="text-sm text-gray-600 mb-2">Collez le comptage physique, une ligne par produit : <code>EAN;quantité</code>. Lecture seule — aucun stock n'est modifié.</p>
      <textarea
        value={raw} onChange={(e) => setRaw(e.target.value)} rows={6}
        placeholder={'3017620422003;12\n5410188031072;0'}
        className="w-full border rounded-lg px-3 py-2 font-mono text-sm mb-3"
      />
      <div className="flex gap-2 mb-4">
        <button onClick={run} disabled={loading || !storeId} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white disabled:opacity-40">Calculer l'écart</button>
        {result && <button onClick={exportCsv} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50 inline-flex items-center gap-1"><Download className="w-4 h-4" /> Export CSV</button>}
      </div>

      {loading && <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /> Calcul…</div>}
      {error && <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg p-3"><AlertCircle className="w-5 h-5" /> {error}</div>}

      {result && !loading && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-white rounded-lg border p-3 text-center"><div className="text-xs text-gray-500">Produits comptés</div><div className="text-xl font-bold">{result.countedProducts}</div></div>
            <div className="bg-white rounded-lg border p-3 text-center"><div className="text-xs text-gray-500">Écarts</div><div className="text-xl font-bold">{result.discrepancyCount}</div></div>
            <div className="bg-white rounded-lg border p-3 text-center"><div className="text-xs text-gray-500">Valeur nette</div><div className={`text-xl font-bold ${result.netValueMinorUnits < 0 ? 'text-red-600' : result.netValueMinorUnits > 0 ? 'text-amber-600' : ''}`}>{eur(result.netValueMinorUnits)}</div></div>
          </div>

          {result.unmatched.length > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">
              {result.unmatched.length} code(s) non trouvé(s) : {result.unmatched.slice(0, 10).join(', ')}{result.unmatched.length > 10 ? '…' : ''}
            </div>
          )}

          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left"><tr><th className="px-3 py-2">Produit</th><th className="px-3 py-2 text-right">Système</th><th className="px-3 py-2 text-right">Compté</th><th className="px-3 py-2 text-right">Écart</th><th className="px-3 py-2 text-right">Valeur</th><th className="px-3 py-2">Statut</th></tr></thead>
              <tbody>
                {result.lines.map((l) => (
                  <tr key={l.productId} className="border-t">
                    <td className="px-3 py-2">{l.name || l.ean}</td>
                    <td className="px-3 py-2 text-right">{l.systemQty}</td>
                    <td className="px-3 py-2 text-right">{l.countedQty}</td>
                    <td className={`px-3 py-2 text-right ${l.qtyDiff !== 0 ? 'font-semibold' : ''}`}>{l.qtyDiff > 0 ? `+${l.qtyDiff}` : l.qtyDiff}</td>
                    <td className={`px-3 py-2 text-right ${l.valueDiffMinorUnits < 0 ? 'text-red-600' : l.valueDiffMinorUnits > 0 ? 'text-amber-600' : ''}`}>{eur(l.valueDiffMinorUnits)}</td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs ${badge(l.status)}`}>{l.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
