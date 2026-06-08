import React, { useState, useEffect, useCallback } from 'react';
import {
  Undo2, Plus, X, Loader2, CheckCircle2, Receipt, Calendar, ChevronRight, Gift,
} from 'lucide-react';
import { returnsApi, salesApi } from '../services/api';

interface CreditNote {
  id: string;
  code: string;
  originalTicketNumber: string | null;
  type: 'refund' | 'store_credit';
  refundMethod: string | null;
  status: string;
  totalMinorUnits: number;
  remainingMinorUnits: number;
  reason: string | null;
  createdAt: string;
}

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

const eur = (c: number) => (c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €';

const STATUS_META: Record<string, { label: string; color: string }> = {
  active: { label: 'Avoir actif', color: 'bg-emerald-50 text-emerald-600' },
  partially_redeemed: { label: 'Partiellement utilisé', color: 'bg-amber-50 text-amber-600' },
  redeemed: { label: 'Utilisé', color: 'bg-gray-100 text-gray-500' },
  refunded: { label: 'Remboursé', color: 'bg-indigo-50 text-indigo-600' },
  cancelled: { label: 'Annulé', color: 'bg-red-50 text-red-600' },
};

export function ReturnsPage() {
  const [notes, setNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);

  const loadNotes = useCallback(async () => {
    try {
      setError(null);
      const res = await returnsApi.list();
      setNotes(res.data?.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur de chargement des avoirs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const onCreated = (code: string) => {
    setWizard(false);
    setSuccess(`Avoir ${code} créé`);
    setTimeout(() => setSuccess(null), 3000);
    loadNotes();
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
            <Undo2 size={28} className="text-bo-accent" />
            Retours & Avoirs
          </h1>
          <p className="text-sm text-bo-muted mt-1">Notes de crédit, remboursements et avoirs réutilisables</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setGiftOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 border border-gray-200 text-bo-text rounded-xl font-semibold text-sm hover:bg-gray-50 transition-colors"
          >
            <Gift size={16} className="text-violet-500" /> Émettre carte cadeau
          </button>
          <button
            onClick={() => setWizard(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-bo-accent text-white rounded-xl font-semibold text-sm hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/20"
          >
            <Plus size={16} /> Nouveau retour
          </button>
        </div>
      </div>

      {success && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={16} /> {success}
        </div>
      )}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-bo-accent" /></div>
      ) : notes.length === 0 ? (
        <div className="text-center py-20 text-bo-muted">
          <Undo2 size={48} className="mx-auto mb-3 opacity-30" />
          <p className="text-lg font-semibold">Aucun avoir</p>
          <p className="text-sm mt-1">Créez un retour depuis une vente existante.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50/50 text-left">
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider">Avoir</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider">Ticket d'origine</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider">Type</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider text-right">Montant</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider text-right">Solde</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider">Statut</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => {
                const st = STATUS_META[n.status] || { label: n.status, color: 'bg-gray-50 text-gray-600' };
                return (
                  <tr key={n.id} className="border-t border-gray-50 hover:bg-gray-50/40">
                    <td className="py-3 px-5 font-mono text-sm font-semibold text-bo-text">{n.code}</td>
                    <td className="py-3 px-5 text-sm text-bo-muted">{n.originalTicketNumber || '—'}</td>
                    <td className="py-3 px-5 text-sm">{n.type === 'store_credit' ? 'Avoir' : `Remboursement ${n.refundMethod || ''}`}</td>
                    <td className="py-3 px-5 text-right text-sm font-semibold">{eur(n.totalMinorUnits)}</td>
                    <td className="py-3 px-5 text-right text-sm">{n.type === 'store_credit' ? eur(n.remainingMinorUnits) : '—'}</td>
                    <td className="py-3 px-5"><span className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${st.color}`}>{st.label}</span></td>
                    <td className="py-3 px-5 text-sm text-bo-muted">{new Date(n.createdAt).toLocaleDateString('fr-FR')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {wizard && <ReturnWizard onClose={() => setWizard(false)} onCreated={onCreated} />}
      {giftOpen && (
        <GiftCardModal
          onClose={() => setGiftOpen(false)}
          onCreated={(code) => { setGiftOpen(false); setSuccess(`Carte cadeau ${code} émise`); setTimeout(() => setSuccess(null), 3000); loadNotes(); }}
        />
      )}
    </div>
  );
}

// ── Gift card issuance ──
function GiftCardModal({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const euros = parseFloat(amount.replace(',', '.'));
    if (!Number.isFinite(euros) || euros <= 0) { setErr('Montant invalide.'); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const idem = (crypto as any).randomUUID ? crypto.randomUUID() : `gc-${Date.now()}`;
      const res = await returnsApi.issueGiftCard(
        { amountMinorUnits: Math.round(euros * 100), code: code.trim() || undefined },
        idem,
      );
      onCreated(res.data?.code || 'GC');
    } catch (e: any) {
      setErr(e.response?.data?.message || "Échec de l'émission.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-bo-text flex items-center gap-2"><Gift size={16} className="text-violet-500" /> Émettre une carte cadeau</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} className="text-bo-muted" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-bo-text mb-1">Montant (€)</label>
            <input type="number" min={0} step="0.01" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-bo-text mb-1">Code (optionnel — sinon généré)</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ex: numéro de carte physique" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
          </div>
          {err && <p className="text-sm text-red-500">{err}</p>}
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-bo-muted hover:bg-gray-50">Annuler</button>
            <button onClick={submit} disabled={submitting} className="px-6 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-2">
              {submitting && <Loader2 size={14} className="animate-spin" />} Émettre
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Return creation wizard ──
function ReturnWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [sales, setSales] = useState<any[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [selectedSale, setSelectedSale] = useState<any | null>(null);
  const [lines, setLines] = useState<ReturnableLine[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<'cash' | 'card' | 'store_credit'>('store_credit');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadSales = useCallback(async () => {
    setLoadingSales(true);
    setErr(null);
    try {
      const res = await salesApi.list(date);
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      setSales(list.filter((s: any) => s.status !== 'voided'));
    } catch {
      setErr('Erreur de chargement des ventes.');
    } finally {
      setLoadingSales(false);
    }
  }, [date]);

  useEffect(() => { if (!selectedSale) loadSales(); }, [loadSales, selectedSale]);

  const pickSale = async (sale: any) => {
    setErr(null);
    try {
      const res = await returnsApi.returnable(sale.id);
      setSelectedSale(res.data.sale || sale);
      const returnable: ReturnableLine[] = (res.data.lines || []).filter((l: ReturnableLine) => l.returnableQty > 0);
      setLines(returnable);
      setQty(Object.fromEntries(returnable.map((l) => [l.lineItemId, 0])));
    } catch (e: any) {
      setErr(e.response?.data?.message || 'Impossible de charger la vente.');
    }
  };

  const refundTotal = lines.reduce((s, l) => {
    const q = qty[l.lineItemId] || 0;
    return s + Math.round((l.lineTotalMinorUnits * q) / l.soldQty);
  }, 0);

  const submit = async () => {
    const items = lines
      .map((l) => ({ lineItemId: l.lineItemId, quantity: qty[l.lineItemId] || 0 }))
      .filter((i) => i.quantity > 0);
    if (items.length === 0) { setErr('Sélectionnez au moins un article.'); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const idem = (crypto as any).randomUUID ? crypto.randomUUID() : `ret-${Date.now()}-${Math.round(refundTotal)}`;
      const res = await returnsApi.create(
        { originalSaleId: selectedSale.id, items, reason: reason || undefined, refundMethod: method },
        idem,
      );
      onCreated(res.data?.code || 'AV');
    } catch (e: any) {
      setErr(e.response?.data?.message || 'Échec de la création du retour.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-auto">
        <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-bo-text">{selectedSale ? 'Articles à retourner' : 'Choisir la vente'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} className="text-bo-muted" /></button>
        </div>

        <div className="px-8 py-6">
          {err && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{err}</div>}

          {!selectedSale ? (
            <>
              <div className="relative mb-4 max-w-xs">
                <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm w-full focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
              </div>
              {loadingSales ? (
                <div className="flex justify-center py-10"><Loader2 size={28} className="animate-spin text-bo-accent" /></div>
              ) : sales.length === 0 ? (
                <p className="text-sm text-bo-muted text-center py-8">Aucune vente ce jour.</p>
              ) : (
                <div className="space-y-1.5 max-h-80 overflow-auto">
                  {sales.map((s) => (
                    <button key={s.id} onClick={() => pickSale(s)} className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-100 hover:border-bo-accent/40 hover:bg-gray-50 transition-colors text-left">
                      <span className="flex items-center gap-2 text-sm"><Receipt size={15} className="text-bo-muted" /> {s.ticketNumber}</span>
                      <span className="flex items-center gap-3"><span className="text-sm font-semibold">{eur(s.totalMinorUnits)}</span><ChevronRight size={15} className="text-bo-muted" /></span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-bo-muted mb-3">Ticket <strong>{selectedSale.ticketNumber}</strong></p>
              <div className="space-y-2 mb-5">
                {lines.length === 0 ? (
                  <p className="text-sm text-bo-muted">Aucun article retournable (déjà tout retourné).</p>
                ) : lines.map((l) => (
                  <div key={l.lineItemId} className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-bo-text">{l.productName}</p>
                      <p className="text-xs text-bo-muted">{eur(l.unitPriceMinorUnits)} · retournable : {l.returnableQty}/{l.soldQty}</p>
                    </div>
                    <input
                      type="number" min={0} max={l.returnableQty} value={qty[l.lineItemId] ?? 0}
                      onChange={(e) => setQty({ ...qty, [l.lineItemId]: Math.max(0, Math.min(l.returnableQty, Number(e.target.value))) })}
                      className="w-20 px-3 py-2 rounded-lg border border-gray-200 text-sm text-right focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Mode de remboursement</label>
                  <select value={method} onChange={(e) => setMethod(e.target.value as any)} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30">
                    <option value="store_credit">Avoir (réutilisable)</option>
                    <option value="cash">Espèces</option>
                    <option value="card">Carte</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Motif (optionnel)</label>
                  <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <div>
                  <p className="text-xs text-bo-muted">Montant du retour</p>
                  <p className="text-xl font-bold text-bo-text">{eur(refundTotal)}</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { setSelectedSale(null); setLines([]); }} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-bo-muted hover:bg-gray-50">Retour</button>
                  <button onClick={submit} disabled={submitting || refundTotal <= 0} className="px-6 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-2">
                    {submitting && <Loader2 size={14} className="animate-spin" />} Valider le retour
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
