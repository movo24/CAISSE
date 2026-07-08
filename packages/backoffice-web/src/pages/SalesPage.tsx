import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ReceiptText, Loader2, AlertTriangle, RefreshCw, Search, XCircle,
  CreditCard, Banknote, Ticket, X, Ban,
} from 'lucide-react';
import { salesApi, returnsApi, documentsApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';

/**
 * Page Ventes (PR #30) — le backend (list/détail/void, tenant-scoped, guards
 * fiscaux) existait sans UI. Lecture d'abord ; le void est manager/admin,
 * motif obligatoire, et les refus serveur (ex : garde « cash réalisé → passer
 * par un avoir ») sont affichés tels quels — jamais contournés.
 */

interface SalePayment {
  id: string;
  method: string;
  amountMinorUnits: number;
  captured?: boolean;
}

interface SaleLineItem {
  id: string;
  productName: string;
  ean: string;
  quantity: number;
  unitPriceMinorUnits: number;
  totalMinorUnits: number;
}

interface Sale {
  id: string;
  ticketNumber: string;
  status: string;
  employeeId: string;
  employeeNameSnapshot: string | null;
  terminalId: string | null;
  sessionId: string | null;
  subtotalMinorUnits: number;
  totalMinorUnits: number;
  createdAt: string;
  completedAt: string | null;
  payments: SalePayment[];
  lineItems: SaleLineItem[];
}

function euros(minor: number | null | undefined): string {
  if (minor == null) return '—';
  return `${(minor / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function dt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const STATUS_STYLE: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-700',
  payment_pending: 'bg-amber-50 text-amber-700',
  voided: 'bg-red-50 text-red-600 line-through',
};

const STATUS_LABEL: Record<string, string> = {
  completed: 'Validée',
  payment_pending: 'À régulariser',
  voided: 'Annulée',
};

function methodIcon(m: string) {
  if (m === 'card') return <CreditCard size={13} className="inline text-indigo-500" />;
  if (m === 'cash') return <Banknote size={13} className="inline text-emerald-500" />;
  return <Ticket size={13} className="inline text-amber-500" />;
}

export function SalesPage() {
  const role = useAuthStore((s) => s.employee?.role || 'cashier');
  const canVoid = role === 'admin' || role === 'manager';

  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<string>(''); // filtre serveur (jour)
  const [search, setSearch] = useState('');     // filtre client (ticket / caissier / terminal)
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [detail, setDetail] = useState<Sale | null>(null);

  // Void — motif obligatoire (précédent produit : remboursement motivé)
  const [voidTarget, setVoidTarget] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  /* ── D1.4 — retour / avoir depuis la vente (pièce opposable) ── */
  interface ReturnableLine {
    lineItemId: string; productName: string; ean: string;
    soldQty: number; returnedQty: number; returnableQty: number;
    unitPriceMinorUnits: number; lineTotalMinorUnits: number;
  }
  interface LinkedCreditNote {
    id: string; code: string; sequentialNumber: number | null; type: string;
    refundMethod: string | null; status: string; totalMinorUnits: number;
    reason: string | null; createdAt: string;
  }
  const [returnTarget, setReturnTarget] = useState<Sale | null>(null);
  const [returnableLines, setReturnableLines] = useState<ReturnableLine[]>([]);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('');
  const [returnMethod, setReturnMethod] = useState<'cash' | 'store_credit' | 'card'>('store_credit');
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnDone, setReturnDone] = useState<LinkedCreditNote | null>(null);
  const [linkedNotes, setLinkedNotes] = useState<LinkedCreditNote[]>([]);

  const openReturnFlow = async (s: Sale) => {
    setReturnTarget(s); setReturnError(null); setReturnDone(null);
    setReturnReason(''); setReturnMethod('store_credit'); setReturnQty({});
    try {
      const res = await returnsApi.returnable(s.id);
      setReturnableLines(res.data?.lines || []);
    } catch (e: any) {
      setReturnError(e?.response?.data?.message || 'Lignes retournables indisponibles');
      setReturnableLines([]);
    }
  };

  const loadLinkedNotes = async (saleId: string) => {
    try {
      const res = await returnsApi.list(1, 20, saleId);
      setLinkedNotes(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch { setLinkedNotes([]); }
  };

  // Estimation affichée (le serveur recalcule au prorata — source de vérité).
  const returnEstimate = returnableLines.reduce((sum, l) => {
    const q = returnQty[l.lineItemId] || 0;
    return sum + Math.round((l.lineTotalMinorUnits * q) / (l.soldQty || 1));
  }, 0);

  const submitReturn = async () => {
    if (!returnTarget || returnReason.trim().length < 3 || returnEstimate <= 0) return;
    setReturning(true); setReturnError(null);
    try {
      const items = Object.entries(returnQty)
        .filter(([, q]) => q > 0)
        .map(([lineItemId, quantity]) => ({ lineItemId, quantity }));
      const res = await returnsApi.create(
        { originalSaleId: returnTarget.id, items, reason: returnReason.trim(), refundMethod: returnMethod },
        `bo-ret-${returnTarget.id}-${Date.now()}`.slice(0, 64),
      );
      setReturnDone(res.data as LinkedCreditNote);
      await loadLinkedNotes(returnTarget.id);
      await load();
    } catch (e: any) {
      // Les refus serveur (sur-retour, garde) sont affichés tels quels.
      setReturnError(e?.response?.data?.message || 'Retour refusé par le serveur.');
    } finally { setReturning(false); }
  };

  const openJustificatif = async (creditNoteId: string) => {
    try {
      const res = await documentsApi.creditNoteJustificatif(creditNoteId);
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { setReturnError('Justificatif PDF indisponible'); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await salesApi.list(date || undefined);
      setSales(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.ticketNumber.toLowerCase().includes(q) ||
        (s.employeeNameSnapshot || '').toLowerCase().includes(q) ||
        (s.terminalId || '').toLowerCase().includes(q)
      );
    });
  }, [sales, search, statusFilter]);

  const completed = filtered.filter((s) => s.status === 'completed');
  const revenue = completed.reduce((sum, s) => sum + s.totalMinorUnits, 0);
  const pendingCount = filtered.filter((s) => s.status === 'payment_pending').length;
  const voidedCount = filtered.filter((s) => s.status === 'voided').length;

  const submitVoid = async () => {
    if (!voidTarget || voidReason.trim().length < 3) return;
    setVoiding(true);
    setVoidError(null);
    try {
      await salesApi.void(voidTarget.id, voidReason.trim());
      setVoidTarget(null);
      setVoidReason('');
      await load();
    } catch (e: any) {
      // Les gardes serveur (ex : leg espèces réalisé → avoir obligatoire) sont
      // affichées telles quelles — le backoffice ne les contourne jamais.
      setVoidError(e?.response?.data?.message || 'Annulation refusée par le serveur.');
    } finally {
      setVoiding(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ReceiptText className="text-indigo-600" size={26} />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Ventes</h1>
            <p className="text-sm text-gray-500">
              Tickets serveur (tenant-scoped). L'annulation est motivée, auditée, et respecte les gardes fiscales (espèces réalisées → avoir).
            </p>
          </div>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
          <RefreshCw size={15} /> Rafraîchir
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-2xl font-bold text-gray-900">{filtered.length}</p>
          <p className="text-xs text-gray-500">Tickets affichés</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-2xl font-bold text-emerald-600">{euros(revenue)}</p>
          <p className="text-xs text-gray-500">CA (ventes validées)</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className={`text-2xl font-bold ${pendingCount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{pendingCount}</p>
          <p className="text-xs text-gray-500">À régulariser (carte non capturée)</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className={`text-2xl font-bold ${voidedCount > 0 ? 'text-red-500' : 'text-gray-400'}`}>{voidedCount}</p>
          <p className="text-xs text-gray-500">Annulées</p>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ticket, caissier, terminal..."
            className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600"
          title="Filtrer par jour (serveur)"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600"
        >
          <option value="all">Tous statuts</option>
          <option value="completed">Validées</option>
          <option value="payment_pending">À régulariser</option>
          <option value="voided">Annulées</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-gray-100 bg-white overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="animate-spin mr-2" size={18} /> Chargement...
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase border-b border-gray-100">
                <th className="px-4 py-3">Ticket</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Caissier</th>
                <th className="px-4 py-3">Terminal</th>
                <th className="px-4 py-3">Paiements</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer" onClick={() => { setDetail(s); void loadLinkedNotes(s.id); }}>
                  <td className="px-4 py-2.5 font-mono text-gray-700">{s.ticketNumber}</td>
                  <td className="px-4 py-2.5 text-gray-500">{dt(s.createdAt)}</td>
                  <td className="px-4 py-2.5">{s.employeeNameSnapshot || s.employeeId.slice(0, 8)}</td>
                  <td className="px-4 py-2.5 text-gray-500">{s.terminalId || '—'}</td>
                  <td className="px-4 py-2.5">
                    {(s.payments || []).map((p) => (
                      <span key={p.id} className="mr-2 whitespace-nowrap">{methodIcon(p.method)} {euros(p.amountMinorUnits)}</span>
                    ))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold">{euros(s.totalMinorUnits)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status] || 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[s.status] || s.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canVoid && s.status === 'completed' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setVoidTarget(s); setVoidReason(''); setVoidError(null); }}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                        title="Annuler la vente (motif obligatoire, audité)"
                      >
                        <Ban size={13} /> Annuler
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Aucune vente</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Détail */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{detail.ticketNumber}</h3>
                <p className="text-xs text-gray-500">
                  {dt(detail.createdAt)} · {detail.employeeNameSnapshot || detail.employeeId.slice(0, 8)}
                  {detail.terminalId ? ` · ${detail.terminalId}` : ''}
                  {detail.sessionId ? '' : ' · session inconnue'}
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="px-6 py-4">
              <table className="w-full text-sm mb-4">
                <tbody>
                  {(detail.lineItems || []).map((li) => (
                    <tr key={li.id} className="border-b border-gray-50">
                      <td className="py-1.5">{li.productName} <span className="text-gray-400 text-xs">×{li.quantity}</span></td>
                      <td className="py-1.5 text-right">{euros(li.totalMinorUnits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="space-y-1 text-sm">
                {(detail.payments || []).map((p) => (
                  <div key={p.id} className="flex justify-between">
                    <span>{methodIcon(p.method)} {p.method}{p.captured === false ? ' (NON capturé)' : ''}</span>
                    <span>{euros(p.amountMinorUnits)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold pt-2 border-t border-gray-100">
                  <span>Total</span><span>{euros(detail.totalMinorUnits)}</span>
                </div>
              </div>

              {/* D1.4 — avoirs liés à la vente (pièces opposables) */}
              {linkedNotes.length > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Avoirs liés</p>
                  {linkedNotes.map((n) => (
                    <div key={n.id} className="flex items-center justify-between text-sm py-1">
                      <span className="font-mono text-gray-600">
                        {n.sequentialNumber != null ? `N°${n.sequentialNumber} · ` : ''}{n.code}
                        <span className="ml-2 text-xs text-gray-400">{n.refundMethod || n.type} · {n.status}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="font-semibold">{euros(n.totalMinorUnits)}</span>
                        <button onClick={() => openJustificatif(n.id)} className="text-xs text-indigo-600 hover:underline">PDF</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {canVoid && detail.status !== 'voided' && (
                <button
                  onClick={() => { const s = detail; setDetail(null); void openReturnFlow(s); }}
                  className="mt-4 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  Créer un retour / avoir
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* D1.4 — création d'un retour / avoir (pièce opposable, motif obligatoire) */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
            {!returnDone ? (
              <>
                <h3 className="text-lg font-bold text-gray-900 mb-1">Retour / avoir — {returnTarget.ticketNumber}</h3>
                <p className="text-sm text-gray-500 mb-4">
                  La vente d'origine reste intouchable. Le retour crée une pièce séparée (avoir numéroté),
                  scellée au journal fiscal ; le cash ne sort que via cette pièce.
                </p>
                <div className="space-y-2 mb-4">
                  {returnableLines.map((l) => (
                    <div key={l.lineItemId} className="flex items-center justify-between text-sm">
                      <span>
                        {l.productName}
                        <span className="text-xs text-gray-400 ml-2">vendu {l.soldQty} · déjà retourné {l.returnedQty}</span>
                      </span>
                      <select
                        value={returnQty[l.lineItemId] || 0}
                        disabled={l.returnableQty === 0}
                        onChange={(e) => setReturnQty((prev) => ({ ...prev, [l.lineItemId]: Number(e.target.value) }))}
                        className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                      >
                        {Array.from({ length: l.returnableQty + 1 }, (_, i) => (
                          <option key={i} value={i}>{i}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  {returnableLines.length === 0 && <p className="text-sm text-gray-400">Aucune ligne retournable.</p>}
                </div>
                <textarea
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="Motif obligatoire (min 3 caractères)..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm mb-3"
                  rows={2}
                />
                <div className="flex items-center justify-between mb-4">
                  <select
                    value={returnMethod}
                    onChange={(e) => setReturnMethod(e.target.value as any)}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  >
                    <option value="store_credit">Avoir (crédit magasin)</option>
                    <option value="cash">Remboursement espèces</option>
                    <option value="card">Remboursement carte</option>
                  </select>
                  <span className="text-sm">Montant estimé : <strong>{euros(returnEstimate)}</strong> <span className="text-xs text-gray-400">(le serveur recalcule)</span></span>
                </div>
                {returnError && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                    <XCircle size={13} /> {returnError}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setReturnTarget(null)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Fermer</button>
                  <button
                    onClick={submitReturn}
                    disabled={returning || returnReason.trim().length < 3 || returnEstimate <= 0}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-2"
                  >
                    {returning && <Loader2 size={13} className="animate-spin" />}
                    Créer l'avoir
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold text-emerald-700 mb-1">Avoir créé</h3>
                <p className="text-sm text-gray-600 mb-4">
                  {returnDone.sequentialNumber != null ? `N°${returnDone.sequentialNumber} · ` : ''}
                  <span className="font-mono">{returnDone.code}</span> · {euros(returnDone.totalMinorUnits)} ·
                  {' '}{returnDone.refundMethod || returnDone.type} — scellé au journal fiscal, stock restauré.
                </p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => openJustificatif(returnDone.id)} className="px-4 py-2 rounded-lg text-sm text-indigo-700 bg-indigo-50 hover:bg-indigo-100">Justificatif PDF</button>
                  <button onClick={() => setReturnTarget(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Fermer</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Void — motif obligatoire */}
      {voidTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Annuler {voidTarget.ticketNumber} ?</h3>
            <p className="text-sm text-gray-500 mb-4">
              Stock restauré, annulation auditée et chaînée. Une vente avec espèces encaissées sera refusée par le serveur — passez par un avoir (retour).
            </p>
            <textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Motif obligatoire (min 3 caractères)..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm mb-2"
              rows={2}
            />
            {voidError && (
              <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                <XCircle size={13} /> {voidError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setVoidTarget(null)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Fermer</button>
              <button
                onClick={submitVoid}
                disabled={voidReason.trim().length < 3 || voiding}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 flex items-center gap-2"
              >
                {voiding && <Loader2 size={13} className="animate-spin" />}
                Confirmer l'annulation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
