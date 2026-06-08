import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Receipt, ChevronRight, Undo2, CheckCircle2, CloudOff } from 'lucide-react';
import { returnsApi } from '../../services/api';
import { useOfflineMode } from '../../hooks/useOfflineMode';
import { usePOSStore } from '../../stores/posStore';
import { useOfflineStore } from '../../stores/offlineStore';

/**
 * POS return flow.
 *  - ONLINE: pick a sale from the server, validate returnable qty, create the avoir.
 *  - OFFLINE: pick a LOCAL ticket from history, queue a deferred return
 *    (credit_note_return) resolved + validated server-side at sync; a conflict
 *    (qty already returned meanwhile) is rejected cleanly with a notification.
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
  const offline = useOfflineMode();
  const isOffline = offline.isOffline;
  return isOffline ? <OfflineReturn onClose={onClose} /> : <OnlineReturn onClose={onClose} />;
}

// ── ONLINE ──
function OnlineReturn({ onClose }: { onClose: () => void }) {
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
    setLoadingSales(true); setErr(null);
    try {
      const res = await returnsApi.listSales(date);
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      setSales(list.filter((s: any) => s.status !== 'voided'));
    } catch { setErr('Impossible de charger les ventes.'); }
    finally { setLoadingSales(false); }
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
    } catch (e: any) { setErr(e.response?.data?.message || 'Vente illisible.'); }
  };

  const refundTotal = lines.reduce((s, l) => s + Math.round((l.lineTotalMinorUnits * (qty[l.lineItemId] || 0)) / l.soldQty), 0);

  const submit = async () => {
    const items = lines.map((l) => ({ lineItemId: l.lineItemId, quantity: qty[l.lineItemId] || 0 })).filter((i) => i.quantity > 0);
    if (!items.length) { setErr('Sélectionnez au moins un article.'); return; }
    setSubmitting(true); setErr(null);
    try {
      const idem = (crypto as any).randomUUID ? crypto.randomUUID() : `ret-${Date.now()}`;
      const res = await returnsApi.create({ originalSaleId: sale.id, items, refundMethod: method }, idem);
      setCreatedCode(res.data?.code || 'AV');
    } catch (e: any) { setErr(e.response?.data?.message || 'Échec du retour.'); }
    finally { setSubmitting(false); }
  };

  return (
    <Shell onClose={onClose} title="Retour / Avoir">
      {err && <ErrBox>{err}</ErrBox>}
      {createdCode ? (
        <Done code={createdCode} method={method} onClose={onClose} />
      ) : !sale ? (
        <>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mb-4 px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40" />
          {loadingSales ? <Spin /> : sales.length === 0 ? <Empty>Aucune vente ce jour.</Empty> : (
            <SaleList items={sales.map((s) => ({ key: s.id, label: s.ticketNumber, right: eur(s.totalMinorUnits), onPick: () => pick(s) }))} />
          )}
        </>
      ) : (
        <ItemPicker
          ticketNumber={sale.ticketNumber}
          rows={lines.map((l) => ({ key: l.lineItemId, name: l.productName, hint: `retournable : ${l.returnableQty}/${l.soldQty}`, max: l.returnableQty, value: qty[l.lineItemId] ?? 0 }))}
          onQty={(k, v) => setQty({ ...qty, [k]: v })}
          method={method} onMethod={setMethod}
          total={refundTotal} submitting={submitting}
          onBack={() => { setSale(null); setLines([]); }} onSubmit={submit}
        />
      )}
    </Shell>
  );
}

// ── OFFLINE ──
function OfflineReturn({ onClose }: { onClose: () => void }) {
  const history = usePOSStore((s) => s.ticketHistory);
  const employee = usePOSStore((s) => s.employee);
  const enqueue = useOfflineStore((s) => s.enqueue);

  const [ticket, setTicket] = useState<any | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<'cash' | 'card' | 'store_credit'>('store_credit');
  const [queued, setQueued] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = (t: any) => {
    setTicket(t);
    setQty(Object.fromEntries((t.items || []).map((it: any) => [it.ean, 0])));
  };

  const refundTotal = (ticket?.items || []).reduce(
    (s: number, it: any) => s + Math.round(((it.unitPriceMinorUnits * it.quantity - (it.discountMinorUnits || 0)) * (qty[it.ean] || 0)) / it.quantity),
    0,
  );

  const submit = () => {
    const items = (ticket.items || [])
      .map((it: any) => ({ ean: it.ean, quantity: qty[it.ean] || 0 }))
      .filter((i: any) => i.quantity > 0);
    if (!items.length) { setErr('Sélectionnez au moins un article.'); return; }
    enqueue({
      type: 'credit_note_return',
      payload: { ticketNumber: ticket.ticketNumber, items, refundMethod: method },
      cashierId: employee?.id || 'unknown',
      cashierName: employee ? `${employee.firstName} ${employee.lastName}` : 'Caissier',
      storeId: employee?.storeId || 'unknown',
    });
    setQueued(true);
  };

  return (
    <Shell onClose={onClose} title="Retour / Avoir (hors-ligne)">
      <div className="mb-4 flex items-start gap-2 bg-amber-50 rounded-xl px-3 py-2 border border-amber-200">
        <CloudOff size={14} className="text-amber-600 mt-0.5 shrink-0" />
        <p className="text-[11px] text-amber-700">Mode hors-ligne : le retour sera <strong>validé à la reconnexion</strong>. En cas de conflit (article déjà retourné), il sera refusé et signalé.</p>
      </div>
      {err && <ErrBox>{err}</ErrBox>}
      {queued ? (
        <div className="text-center py-8">
          <CheckCircle2 size={44} className="mx-auto text-emerald-500 mb-3" />
          <p className="text-sm font-semibold text-gray-800">Retour mis en file</p>
          <p className="text-xs text-gray-500 mt-1">Il sera validé automatiquement à la reconnexion.</p>
          <button onClick={onClose} className="mt-6 px-6 py-3 rounded-2xl bg-emerald-600 text-white font-semibold">Fermer</button>
        </div>
      ) : !ticket ? (
        history.length === 0 ? <Empty>Aucun ticket récent local.</Empty> : (
          <SaleList items={history.slice(0, 50).map((t, i) => ({ key: `${t.ticketNumber}-${i}`, label: t.ticketNumber, right: eur(t.totalMinorUnits), onPick: () => pick(t) }))} />
        )
      ) : (
        <ItemPicker
          ticketNumber={ticket.ticketNumber}
          rows={(ticket.items || []).map((it: any) => ({ key: it.ean, name: it.name, hint: `vendu : ${it.quantity}`, max: it.quantity, value: qty[it.ean] ?? 0 }))}
          onQty={(k, v) => setQty({ ...qty, [k]: v })}
          method={method} onMethod={setMethod}
          total={refundTotal} submitting={false} submitLabel="Mettre en file"
          onBack={() => setTicket(null)} onSubmit={submit}
        />
      )}
    </Shell>
  );
}

// ── Shared presentational bits ──
function Shell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-white rounded-3xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Undo2 size={18} /> {title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} className="text-gray-500" /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
const ErrBox = ({ children }: { children: React.ReactNode }) => <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{children}</div>;
const Spin = () => <div className="flex justify-center py-10"><Loader2 size={28} className="animate-spin text-emerald-500" /></div>;
const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-gray-500 text-center py-8">{children}</p>;

function SaleList({ items }: { items: { key: string; label: string; right: string; onPick: () => void }[] }) {
  return (
    <div className="space-y-1.5 max-h-80 overflow-auto">
      {items.map((it) => (
        <button key={it.key} onClick={it.onPick} className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-100 hover:border-emerald-300 hover:bg-gray-50 text-left">
          <span className="flex items-center gap-2 text-sm"><Receipt size={15} className="text-gray-400" /> {it.label}</span>
          <span className="flex items-center gap-3 text-sm font-semibold">{it.right} <ChevronRight size={15} className="text-gray-400" /></span>
        </button>
      ))}
    </div>
  );
}

function ItemPicker(props: {
  ticketNumber: string;
  rows: { key: string; name: string; hint: string; max: number; value: number }[];
  onQty: (key: string, v: number) => void;
  method: 'cash' | 'card' | 'store_credit';
  onMethod: (m: 'cash' | 'card' | 'store_credit') => void;
  total: number; submitting: boolean; submitLabel?: string;
  onBack: () => void; onSubmit: () => void;
}) {
  return (
    <>
      <p className="text-sm text-gray-500 mb-3">Ticket <strong>{props.ticketNumber}</strong></p>
      <div className="space-y-2 mb-5">
        {props.rows.length === 0 ? <p className="text-sm text-gray-500">Aucun article retournable.</p> : props.rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-100">
            <div><p className="text-sm font-medium text-gray-900">{r.name}</p><p className="text-xs text-gray-500">{r.hint}</p></div>
            <input type="number" min={0} max={r.max} value={r.value}
              onChange={(e) => props.onQty(r.key, Math.max(0, Math.min(r.max, Number(e.target.value))))}
              className="w-20 px-3 py-2 rounded-lg border border-gray-200 text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-400/40" />
          </div>
        ))}
      </div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">Mode</label>
      <select value={props.method} onChange={(e) => props.onMethod(e.target.value as any)} className="w-full mb-4 px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40">
        <option value="store_credit">Avoir (réutilisable)</option>
        <option value="cash">Espèces</option>
        <option value="card">Carte</option>
      </select>
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <div><p className="text-xs text-gray-500">Montant</p><p className="text-xl font-bold text-gray-900">{(props.total / 100).toFixed(2)} €</p></div>
        <div className="flex gap-3">
          <button onClick={props.onBack} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500">Retour</button>
          <button onClick={props.onSubmit} disabled={props.submitting || props.total <= 0} className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
            {props.submitting && <Loader2 size={14} className="animate-spin" />} {props.submitLabel || 'Valider'}
          </button>
        </div>
      </div>
    </>
  );
}

function Done({ code, method, onClose }: { code: string; method: string; onClose: () => void }) {
  return (
    <div className="text-center py-8">
      <CheckCircle2 size={44} className="mx-auto text-emerald-500 mb-3" />
      <p className="text-sm text-gray-600">Retour validé</p>
      <p className="text-2xl font-black text-gray-900 mt-1 font-mono">{code}</p>
      <p className="text-xs text-gray-500 mt-2">{method === 'store_credit' ? 'Avoir réutilisable en caisse' : 'Remboursement enregistré'}</p>
      <button onClick={onClose} className="mt-6 px-6 py-3 rounded-2xl bg-emerald-600 text-white font-semibold">Fermer</button>
    </div>
  );
}
