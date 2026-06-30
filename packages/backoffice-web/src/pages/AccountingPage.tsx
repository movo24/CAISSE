import React, { useState, useEffect, useCallback } from 'react';
import { Calculator, Download, Loader2, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { comptamaxApi } from '../services/api';
import { useCurrentStoreId } from '../hooks/useCurrentStoreId';

/** centimes → "12,34 €" */
function eur(minor: number): string {
  return (Number(minor || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface JournalLine { account: string; label: string; debitMinorUnits: number; creditMinorUnits: number }
interface JournalResult { lines: JournalLine[]; totals: { debit: number; credit: number }; balanced: boolean; eventCount: number }
interface BucketControl { bucket: string; capturedMinorUnits: number; declaredMinorUnits: number; diffMinorUnits: number }
interface CashControlResult {
  byBucket: BucketControl[];
  capturedByMethod?: { method: string; bucket: string; capturedMinorUnits: number }[];
  totalCapturedMinorUnits: number; totalDeclaredMinorUnits: number; totalDiffMinorUnits: number;
  balanced: boolean; zReportCount: number;
}

export function AccountingPage() {
  const storeId = useCurrentStoreId();
  const today = new Date().toISOString().split('T')[0];
  const [tab, setTab] = useState<'journal' | 'cash'>('journal');
  const [date, setDate] = useState(today);
  const [journal, setJournal] = useState<JournalResult | null>(null);
  const [cash, setCash] = useState<CashControlResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (tab === 'journal') {
        const res = await comptamaxApi.journal({ date });
        setJournal(res.data);
      } else {
        const res = await comptamaxApi.cashControl({ date });
        setCash(res.data);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erreur lors du chargement.');
    } finally {
      setLoading(false);
    }
  }, [tab, date]);

  useEffect(() => { if (storeId) load(); }, [load, storeId]);

  const exportCsv = async () => {
    try {
      if (tab === 'journal') {
        const res = await comptamaxApi.journal({ date, format: 'csv' });
        downloadCsv(`journal_${date}.csv`, typeof res.data === 'string' ? res.data : '');
      } else {
        const res = await comptamaxApi.cashControl({ date, format: 'csv' });
        downloadCsv(`controle_caisse_${date}.csv`, typeof res.data === 'string' ? res.data : '');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || "Erreur lors de l'export CSV.");
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Calculator className="w-7 h-7 text-indigo-600" />
        <h1 className="text-2xl font-bold">Comptabilité / Intégration</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex rounded-lg border overflow-hidden">
          <button onClick={() => setTab('journal')} className={`px-4 py-2 text-sm ${tab === 'journal' ? 'bg-indigo-600 text-white' : 'bg-white'}`}>Journal compta</button>
          <button onClick={() => setTab('cash')} className={`px-4 py-2 text-sm ${tab === 'cash' ? 'bg-indigo-600 text-white' : 'bg-white'}`}>Contrôle de caisse</button>
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
        <button onClick={load} className="px-3 py-2 text-sm rounded-lg border hover:bg-gray-50">Actualiser</button>
        <button onClick={exportCsv} className="px-3 py-2 text-sm rounded-lg border hover:bg-gray-50 inline-flex items-center gap-1">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {!storeId && <p className="text-amber-600 text-sm">Sélectionnez un magasin pour afficher les données.</p>}
      {loading && <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /> Chargement…</div>}
      {error && <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg p-3"><AlertCircle className="w-5 h-5" /> {error}</div>}

      {!loading && !error && tab === 'journal' && journal && (
        journal.lines.length === 0 ? (
          <p className="text-gray-500">Aucune écriture pour cette date.</p>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b text-sm">
              <span>{journal.eventCount} évènement(s)</span>
              <span className={journal.balanced ? 'text-green-600 inline-flex items-center gap-1' : 'text-red-600 inline-flex items-center gap-1'}>
                {journal.balanced ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {journal.balanced ? 'Équilibré' : 'DÉSÉQUILIBRÉ'}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left"><tr><th className="px-4 py-2">Compte</th><th className="px-4 py-2">Libellé</th><th className="px-4 py-2 text-right">Débit</th><th className="px-4 py-2 text-right">Crédit</th></tr></thead>
              <tbody>
                {journal.lines.map((l, i) => (
                  <tr key={i} className="border-t"><td className="px-4 py-2 font-mono">{l.account}</td><td className="px-4 py-2">{l.label}</td><td className="px-4 py-2 text-right">{l.debitMinorUnits ? eur(l.debitMinorUnits) : ''}</td><td className="px-4 py-2 text-right">{l.creditMinorUnits ? eur(l.creditMinorUnits) : ''}</td></tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold"><tr><td className="px-4 py-2" colSpan={2}>Totaux</td><td className="px-4 py-2 text-right">{eur(journal.totals.debit)}</td><td className="px-4 py-2 text-right">{eur(journal.totals.credit)}</td></tr></tfoot>
            </table>
          </div>
        )
      )}

      {!loading && !error && tab === 'cash' && cash && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b text-sm">
            <span>{cash.zReportCount} Z-report(s)</span>
            <span className={cash.balanced ? 'text-green-600 inline-flex items-center gap-1' : 'text-red-600 inline-flex items-center gap-1'}>
              {cash.balanced ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {cash.balanced ? 'Aucun écart' : `Écart ${eur(cash.totalDiffMinorUnits)}`}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left"><tr><th className="px-4 py-2">Moyen</th><th className="px-4 py-2 text-right">Encaissé</th><th className="px-4 py-2 text-right">Déclaré (Z)</th><th className="px-4 py-2 text-right">Écart</th></tr></thead>
            <tbody>
              {cash.byBucket.map((b) => (
                <tr key={b.bucket} className="border-t"><td className="px-4 py-2 capitalize">{b.bucket}</td><td className="px-4 py-2 text-right">{eur(b.capturedMinorUnits)}</td><td className="px-4 py-2 text-right">{eur(b.declaredMinorUnits)}</td><td className={`px-4 py-2 text-right ${b.diffMinorUnits !== 0 ? 'text-red-600 font-semibold' : ''}`}>{eur(b.diffMinorUnits)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
