import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Receipt, ChevronRight, Undo2, CheckCircle2 } from 'lucide-react';
import { returnsApi } from '../../services/api';

/**
 * Self-contained POS return flow (online only — a return needs the server-side
 * original sale + credit-note creation). Mounted from POSPage behind canRefund.
 */

interface ReturnableLine {
  lineItemId: string;
  productName: string;
  ean: string;
  soldQty: number;
  returnedQty: number;
  returnableQty: number;
  unitPriceMinorUnits: number;
  lineTotalMinorUnits: number;
}

const eur = (c: number) => (c / 100).toFixed(2) + ' €';
const today = () => new Date().toISOString().split('T')[0];

export function ReturnModal({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState(today());
  const [sales, setSales] = useState<any[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [sale, setSale] = useState<any | null>(null);
  const [lines, setLines] = useState<ReturnableLine[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<'cash' | 'card' | 'store_credit'>('store_credit');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const loadSales = useCallback(async () => {
    setLoadingSales(true);
    setErr(null);
    try {
      const res = await returnsApi.listSales(date);
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      setSales(list.filter((s: any) => s.status !== 'voided'));
    } catch {
      setErr('Impossible de charger les ventes (hors-ligne ?).');
    } finally {
      setLoadingSales(false);
    }
  }, [date]);

  useEffect(() => { if (!sale && !createdCode) loadSales(); }, [loadSales, sale, createdCode]);

  const pick = async (s: any) => {
    setErr(null);
    try {
      const res = await returnsApi.returnable(s.id);
      setSale(res.data.sale || s);
      const ret = (res.data.lines || []).filter((l: ReturnableLine) => l.returnableQty > 0);
      setLines(ret);
      setQty(Object.fromEntries(ret.map((l: ReturnableLine) => [l.lineItemId, 0])));
    } catch (e: any) {
      setErr(e.response?.data?.message || 'Vente illisible.');
    }
  };

  const refundTotal = lines.reduce(
    (s, l) => s + Math.round((l.lineTotalMinorUnits * (qty[l.lineItemId] || 0)) / l.soldQty),
    0,
  );

  const submit = async () => {
    const items = lines
      .map((l) => ({ lineItemId: l.lineItemId, quantity: qty[l.lineItemId] || 0 }))
      .filter((i) => i.quantity > 0);
    if (!items.length) { setErr('Sélectionnez au moins un article.'); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const idem = (crypto as any).randomUUID ? crypto.randomUUID() : `ret-${Date.now()}`;
      const res = await returnsApi.create({ originalSaleId: sale.id, items, refundMethod: method }, idem);
      setCreatedCode(res.data?.code || 'AV');
    } catch (e: any) {
      setErr(e.response?.data?.message || 'Échec du retour.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-white rounded-3xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Undo2 size={18} /> Retour / Avoir</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="p-6">
          {err && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{err}</div>}

          {createdCode ? (
            <div className="text-center py-8">
              <CheckCircle2 size={44} className="mx-auto text-emerald-500 mb-3" />
              <p className="text-sm text-gray-600">Retour validé</p>
              <p className="text-2xl font-black text-gray-900 mt-1 font-mono">{createdCode}</p>
              <p className="text-xs text-gray-500 mt-2">{method === 'store_credit' ? 'Avoir réutilisable en caisse' : 'Remboursement enregistré'}</p>
              <button onClick={onClose} className="mt-6 px-6 py-3 rounded-2xl bg-emerald-600 text-white font-semibold">Fermer</button>
            </div>
          ) : !sale ? (
            <>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mb-4 px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40" />
              {loadingSales ? (
                <div className="flex justify-center py-10"><Loader2 size={28} className="animate-spin text-emerald-500" /></div>
              ) : sales.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">Aucune vente ce jour.</p>
              ) : (
                <div className="space-y-1.5 max-h-80 overflow-auto">
                  {sales.map((s) => (
                    <button key={s.id} onClick={() => pick(s)} className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-100 hover:border-emerald-300 hover:bg-gray-50 text-left">
                      <span className="flex items-center gap-2 text-sm"><Receipt size={15} className="text-gray-400" /> {s.ticketNumber}</span>
                      <span className="flex items-center gap-3 text-sm font-semibold">{eur(s.totalMinorUnits)} <ChevronRight size={15} className="text-gray-400" /></span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-3">Ticket <strong>{sale.ticketNumber}</strong></p>
              <div className="space-y-2 mb-5">
                {lines.length === 0 ? (
                  <p className="text-sm text-gray-500">Aucun article retournable.</p>
                ) : lines.map((l) => (
                  <div key={l.lineItemId} className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{l.productName}</p>
                      <p className="text-xs text-gray-500">retournable : {l.returnableQty}/{l.soldQty}</p>
                    </div>
                    <input type="number" min={0} max={l.returnableQty} value={qty[l.lineItemId] ?? 0}
                      onChange={(e) => setQty({ ...qty, [l.lineItemId]: Math.max(0, Math.min(l.returnableQty, Number(e.target.value))) })}
                      className="w-20 px-3 py-2 rounded-lg border border-gray-200 text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-400/40" />
                  </div>
                ))}
              </div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Mode</label>
              <select value={method} onChange={(e) => setMethod(e.target.value as any)} className="w-full mb-4 px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40">
                <option value="store_credit">Avoir (réutilisable)</option>
                <option value="cash">Espèces</option>
                <option value="card">Carte</option>
              </select>
              <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <div><p className="text-xs text-gray-500">Montant</p><p className="text-xl font-bold text-gray-900">{eur(refundTotal)}</p></div>
                <div className="flex gap-3">
                  <button onClick={() => { setSale(null); setLines([]); }} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500">Retour</button>
                  <button onClick={submit} disabled={submitting || refundTotal <= 0} className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
                    {submitting && <Loader2 size={14} className="animate-spin" />} Valider
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
