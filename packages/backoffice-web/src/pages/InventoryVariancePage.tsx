import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardCheck, Plus, X, Loader2, CheckCircle2, AlertTriangle,
  PackageSearch, ShieldCheck, Ban,
} from 'lucide-react';
import { productsApi, stockReconciliationApi } from '../services/api';

interface Product {
  id: string;
  ean: string;
  name: string;
  priceMinorUnits: number;
  stockQuantity: number;
  parentProductId: string | null;
  sku: string | null;
  variantName: string | null;
}

interface Variance {
  id: string;
  productId: string;
  theoreticalQty: number;
  physicalQty: number;
  variancePct: number;
  status: string;
}

type Reason = 'casse' | 'vol' | 'erreur_inventaire' | 'perte' | 'perime' | 'autre';

const REASONS: { value: Reason; label: string }[] = [
  { value: 'casse', label: 'Casse' },
  { value: 'vol', label: 'Vol' },
  { value: 'erreur_inventaire', label: "Erreur d'inventaire" },
  { value: 'perte', label: 'Perte' },
  { value: 'perime', label: 'Périmé' },
  { value: 'autre', label: 'Autre' },
];

export function InventoryVariancePage() {
  const [variances, setVariances] = useState<Variance[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Count form
  const [countOpen, setCountOpen] = useState(false);
  const [countProductId, setCountProductId] = useState('');
  const [countPhysicalQty, setCountPhysicalQty] = useState('');
  const [counting, setCounting] = useState(false);

  // Confirm modal
  const [confirmTarget, setConfirmTarget] = useState<Variance | null>(null);
  const [confirmedQty, setConfirmedQty] = useState('');
  const [reason, setReason] = useState<Reason | ''>('');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const flash = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3500);
  };

  const productLabel = useCallback(
    (productId: string): string => {
      const p = products.find((x) => x.id === productId);
      if (!p) return productId;
      const variant = p.variantName ? ` · ${p.variantName}` : '';
      return `${p.name}${variant}`;
    },
    [products],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [varRes, prodRes] = await Promise.all([
        stockReconciliationApi.pending(),
        productsApi.list({}),
      ]);
      const varList: Variance[] = Array.isArray(varRes.data) ? varRes.data : varRes.data?.data || [];
      const prodList: Product[] = prodRes.data?.data || [];
      setVariances(varList);
      setProducts(prodList);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitCount = async () => {
    if (!countProductId) { setError('Sélectionnez un produit.'); return; }
    const qty = parseInt(countPhysicalQty, 10);
    if (!Number.isFinite(qty) || qty < 0) { setError('Quantité physique invalide.'); return; }
    setCounting(true);
    setError(null);
    try {
      const res = await stockReconciliationApi.count({ productId: countProductId, physicalQty: qty });
      const result: { requiresReview?: boolean; applied?: boolean } = res.data || {};
      if (result.requiresReview) {
        flash('Écart détecté : un contrôle manuel est requis. Voir les écarts en attente ci-dessous.');
      } else {
        flash('Comptage appliqué directement (aucun écart significatif).');
      }
      setCountOpen(false);
      setCountProductId('');
      setCountPhysicalQty('');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setCounting(false);
    }
  };

  const openConfirm = (v: Variance) => {
    setConfirmTarget(v);
    setConfirmedQty(String(v.physicalQty));
    setReason('');
    setConfirmError(null);
  };

  const submitConfirm = async () => {
    if (!confirmTarget) return;
    if (!reason) { setConfirmError('Le motif est obligatoire.'); return; }
    const qty = parseInt(confirmedQty, 10);
    if (!Number.isFinite(qty) || qty < 0) { setConfirmError('Quantité confirmée invalide.'); return; }
    setConfirming(true);
    setConfirmError(null);
    try {
      await stockReconciliationApi.confirm(confirmTarget.id, { confirmedQty: qty, reason });
      setConfirmTarget(null);
      flash('Correction confirmée.');
      await load();
    } catch (e: any) {
      setConfirmError(e?.response?.data?.message || 'Erreur');
    } finally {
      setConfirming(false);
    }
  };

  const rejectVariance = async (v: Variance) => {
    setRejectingId(v.id);
    setError(null);
    try {
      await stockReconciliationApi.reject(v.id);
      flash('Écart rejeté.');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setRejectingId(null);
    }
  };

  const variancePctClass = (pct: number): string => {
    const abs = Math.abs(pct);
    if (abs >= 20) return 'bg-red-50 text-red-600';
    if (abs >= 5) return 'bg-amber-50 text-amber-700';
    return 'bg-emerald-50 text-emerald-700';
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-bo-text flex items-center gap-2">
          <ClipboardCheck size={22} className="text-bo-accent" />
          Écarts d'inventaire
        </h1>
        <button
          onClick={() => { setCountOpen(true); setError(null); }}
          className="px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 flex items-center gap-1.5"
        >
          <Plus size={15} /> Saisir un comptage
        </button>
      </div>
      <p className="text-sm text-bo-muted mb-4">
        Comptage physique du stock et arbitrage humain des écarts (décision 7).
      </p>

      {success && (
        <div className="mb-4 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={16} className="shrink-0" /> {success}
        </div>
      )}
      {error && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" /> {error}
        </div>
      )}

      {/* Pending variances */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <h2 className="text-sm font-bold text-bo-text mb-3 flex items-center gap-2">
          <PackageSearch size={16} className="text-bo-muted" />
          Écarts en attente
          {variances.length > 0 && (
            <span className="ml-1 text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              {variances.length}
            </span>
          )}
        </h2>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={28} className="animate-spin text-bo-accent" />
          </div>
        ) : variances.length === 0 ? (
          <div className="text-center py-12 text-bo-muted">
            <ShieldCheck size={40} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm font-semibold">Aucun écart en attente</p>
            <p className="text-xs mt-1">Les comptages sans écart significatif sont appliqués automatiquement.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-100">
                  <th className="py-2 px-3 text-xs font-semibold text-bo-muted uppercase tracking-wider">Produit</th>
                  <th className="py-2 px-3 text-xs font-semibold text-bo-muted uppercase tracking-wider text-right">Théorique</th>
                  <th className="py-2 px-3 text-xs font-semibold text-bo-muted uppercase tracking-wider text-right">Physique</th>
                  <th className="py-2 px-3 text-xs font-semibold text-bo-muted uppercase tracking-wider text-right">Écart %</th>
                  <th className="py-2 px-3" />
                </tr>
              </thead>
              <tbody>
                {variances.map((v) => (
                  <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                    <td className="py-3 px-3 text-bo-text font-medium">{productLabel(v.productId)}</td>
                    <td className="py-3 px-3 text-right text-bo-muted">{v.theoreticalQty}</td>
                    <td className="py-3 px-3 text-right text-bo-text font-semibold">{v.physicalQty}</td>
                    <td className="py-3 px-3 text-right">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${variancePctClass(v.variancePct)}`}>
                        {v.variancePct > 0 ? '+' : ''}{v.variancePct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openConfirm(v)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 flex items-center gap-1"
                        >
                          <CheckCircle2 size={13} /> Confirmer la correction
                        </button>
                        <button
                          onClick={() => rejectVariance(v)}
                          disabled={rejectingId === v.id}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-40 flex items-center gap-1"
                        >
                          {rejectingId === v.id ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} Rejeter
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Count form modal */}
      {countOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-bold text-bo-text flex items-center gap-2">
                <ClipboardCheck size={17} className="text-bo-accent" /> Saisir un comptage
              </h2>
              <button onClick={() => setCountOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={18} className="text-bo-muted" />
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">Produit</label>
                <select
                  value={countProductId}
                  onChange={(e) => setCountProductId(e.target.value)}
                  className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm"
                >
                  <option value="">— Sélectionner un produit —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.variantName ? ` · ${p.variantName}` : ''} ({p.ean})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">Quantité physique comptée</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={countPhysicalQty}
                  onChange={(e) => setCountPhysicalQty(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-gray-200 text-sm w-full"
                  placeholder="0"
                />
              </div>
              <p className="text-xs text-bo-muted">
                Sans écart significatif, le comptage est appliqué directement. Sinon, il est mis en attente de validation.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setCountOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-bo-muted hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  onClick={submitCount}
                  disabled={counting}
                  className="px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {counting && <Loader2 size={14} className="animate-spin" />} Enregistrer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm correction modal */}
      {confirmTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-bold text-bo-text flex items-center gap-2">
                <CheckCircle2 size={17} className="text-emerald-600" /> Confirmer la correction
              </h2>
              <button onClick={() => setConfirmTarget(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={18} className="text-bo-muted" />
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div className="rounded-lg bg-gray-50 px-3 py-2.5 text-sm">
                <p className="font-semibold text-bo-text">{productLabel(confirmTarget.productId)}</p>
                <p className="text-xs text-bo-muted mt-0.5">
                  Théorique : {confirmTarget.theoreticalQty} · Physique : {confirmTarget.physicalQty} ·{' '}
                  Écart : {confirmTarget.variancePct > 0 ? '+' : ''}{confirmTarget.variancePct.toFixed(1)}%
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">Quantité confirmée</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={confirmedQty}
                  onChange={(e) => setConfirmedQty(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-gray-200 text-sm w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">
                  Motif <span className="text-red-500">*</span>
                </label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as Reason)}
                  className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm"
                >
                  <option value="">— Sélectionner un motif —</option>
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              {confirmError && (
                <p className="text-sm text-red-600 flex items-center gap-1.5">
                  <AlertTriangle size={14} /> {confirmError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setConfirmTarget(null)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-bo-muted hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  onClick={submitConfirm}
                  disabled={confirming || !reason}
                  className="px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {confirming && <Loader2 size={14} className="animate-spin" />} Confirmer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
