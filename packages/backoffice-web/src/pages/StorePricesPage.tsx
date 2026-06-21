import { useState, useEffect, useCallback } from 'react';
import {
  Tag,
  Search,
  Store,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { productsApi } from '../services/api';

/* ── Types ── */

interface Product {
  id: string;
  ean: string;
  name: string;
  priceMinorUnits: number;
  stockQuantity: number;
  parentProductId?: string | null;
  sku?: string | null;
  variantName?: string | null;
}

interface StoreProductPrice {
  priceMinorUnits: number;
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

/* ── Helpers ── */

const fmtMoney = (minor: number): string => (minor / 100).toFixed(2) + ' €';

const toMinor = (euros: string): number => Math.round(parseFloat(euros) * 100);

// Convert an ISO date-time to the value expected by <input type="datetime-local">.
const toLocalInput = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

const fmtDateTime = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// An override "applies" when it exists, is active, and we are inside its window.
const overrideApplies = (ov: StoreProductPrice | null): boolean => {
  if (!ov || !ov.isActive) return false;
  const now = Date.now();
  if (ov.startsAt) {
    const s = new Date(ov.startsAt).getTime();
    if (!isNaN(s) && now < s) return false;
  }
  if (ov.endsAt) {
    const e = new Date(ov.endsAt).getTime();
    if (!isNaN(e) && now > e) return false;
  }
  return true;
};

/* ── Main Page ── */

export function StorePricesPage() {
  // Search / results
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  // Selection + its override
  const [selected, setSelected] = useState<Product | null>(null);
  const [override, setOverride] = useState<StoreProductPrice | null>(null);
  const [loadingOverride, setLoadingOverride] = useState(false);

  // Form (inline panel)
  const [formOpen, setFormOpen] = useState(false);
  const [priceEuros, setPriceEuros] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Banners
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await productsApi.list({ search: search.trim() || undefined });
      setProducts((res.data?.data || []) as Product[]);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const loadOverride = useCallback(async (productId: string) => {
    setLoadingOverride(true);
    setError(null);
    try {
      const res = await productsApi.getStorePrice(productId);
      setOverride((res.data as StoreProductPrice | null) ?? null);
    } catch (e: any) {
      setOverride(null);
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setLoadingOverride(false);
    }
  }, []);

  const handleSelect = (p: Product) => {
    setSelected(p);
    setOverride(null);
    setFormOpen(false);
    setError(null);
    setSuccess(null);
    loadOverride(p.id);
  };

  const openForm = () => {
    if (!selected) return;
    // Prefill from current override if present, else from base price.
    setPriceEuros(
      ((override ? override.priceMinorUnits : selected.priceMinorUnits) / 100).toFixed(2),
    );
    setStartsAt(toLocalInput(override?.startsAt));
    setEndsAt(toLocalInput(override?.endsAt));
    setError(null);
    setSuccess(null);
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    if (!selected) return;
    const minor = toMinor(priceEuros);
    if (isNaN(minor) || minor < 0) {
      setError('Prix invalide');
      return;
    }
    if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setError('La date de fin doit être postérieure à la date de début');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await productsApi.setStorePrice(selected.id, {
        priceMinorUnits: minor,
        startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
      });
      setSuccess('Prix magasin enregistré');
      setFormOpen(false);
      await loadOverride(selected.id);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await productsApi.clearStorePrice(selected.id);
      setSuccess('Prix de base rétabli');
      setOverride(null);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const applies = overrideApplies(override);
  const appliedPriceMinor =
    selected && applies && override ? override.priceMinorUnits : selected?.priceMinorUnits ?? 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-bo-text mb-4 flex items-center gap-2">
        <Tag size={22} className="text-bo-accent" />
        Prix par magasin
      </h1>
      <p className="text-sm text-bo-muted mb-4">
        Définissez un prix de vente spécifique à ce magasin pour un produit. À défaut, le prix de
        base catalogue s'applique.
      </p>

      {/* Banners */}
      {error && (
        <div className="mb-3 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      {success && (
        <div className="mb-3 flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg px-3 py-2">
          <CheckCircle2 size={16} />
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ── Search + results ── */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search
                size={15}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadProducts();
                }}
                placeholder="Rechercher un produit (nom, EAN)…"
                className="w-full pl-8 pr-2 py-1 rounded-lg border border-gray-200 text-sm"
              />
            </div>
            <button
              onClick={loadProducts}
              className="px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90"
            >
              Chercher
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-bo-muted py-8 justify-center">
              <Loader2 size={16} className="animate-spin" />
              Chargement…
            </div>
          ) : products.length === 0 ? (
            <p className="text-sm text-bo-muted py-8 text-center">Aucun produit trouvé.</p>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-[28rem] overflow-y-auto -mx-1">
              {products.map((p) => {
                const isSel = selected?.id === p.id;
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => handleSelect(p)}
                      className={`w-full text-left px-2 py-2 rounded-lg transition-colors ${
                        isSel ? 'bg-bo-accent/10' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-bo-text truncate">
                          {p.name}
                          {p.variantName ? (
                            <span className="text-bo-muted font-normal"> · {p.variantName}</span>
                          ) : null}
                        </span>
                        <span className="text-sm font-semibold text-bo-text shrink-0">
                          {fmtMoney(p.priceMinorUnits)}
                        </span>
                      </div>
                      <div className="text-xs text-bo-muted mt-0.5 flex items-center gap-2">
                        <span className="font-mono">{p.ean}</span>
                        {p.sku ? <span>· {p.sku}</span> : null}
                        <span>· stock {p.stockQuantity}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── Selected product detail ── */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          {!selected ? (
            <div className="flex flex-col items-center justify-center text-center text-bo-muted py-12">
              <Store size={28} className="mb-2 text-gray-300" />
              <p className="text-sm">Sélectionnez un produit pour voir et modifier son prix.</p>
            </div>
          ) : (
            <div>
              <div className="mb-3">
                <h2 className="text-base font-bold text-bo-text">{selected.name}</h2>
                <p className="text-xs text-bo-muted font-mono mt-0.5">{selected.ean}</p>
              </div>

              {loadingOverride ? (
                <div className="flex items-center gap-2 text-sm text-bo-muted py-6 justify-center">
                  <Loader2 size={16} className="animate-spin" />
                  Chargement du prix magasin…
                </div>
              ) : (
                <>
                  {/* Which price applies */}
                  <div
                    className={`rounded-lg border px-3 py-2 mb-3 ${
                      applies
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-emerald-50 border-emerald-200'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      {applies ? (
                        <>
                          <CheckCircle2 size={14} className="text-amber-600" />
                          <span className="text-amber-700">Prix magasin actif</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={14} className="text-emerald-600" />
                          <span className="text-emerald-700">Prix de base appliqué</span>
                        </>
                      )}
                    </div>
                    <p
                      className={`text-2xl font-bold mt-1 ${
                        applies ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {fmtMoney(appliedPriceMinor)}
                    </p>
                  </div>

                  {/* Price breakdown */}
                  <dl className="text-sm space-y-2 mb-4">
                    <div className="flex items-center justify-between">
                      <dt className="text-bo-muted">Prix de base</dt>
                      <dd className="font-semibold text-bo-text">
                        {fmtMoney(selected.priceMinorUnits)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-bo-muted">Override magasin</dt>
                      <dd className="text-bo-text">
                        {override ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="font-semibold">
                              {fmtMoney(override.priceMinorUnits)}
                            </span>
                            {applies ? (
                              <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                                <CheckCircle2 size={12} /> actif
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                                <XCircle size={12} /> inactif
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-bo-muted">Aucun</span>
                        )}
                      </dd>
                    </div>
                    {override && (
                      <>
                        <div className="flex items-center justify-between">
                          <dt className="text-bo-muted">Début</dt>
                          <dd className="text-bo-text">{fmtDateTime(override.startsAt)}</dd>
                        </div>
                        <div className="flex items-center justify-between">
                          <dt className="text-bo-muted">Fin</dt>
                          <dd className="text-bo-text">{fmtDateTime(override.endsAt)}</dd>
                        </div>
                      </>
                    )}
                  </dl>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={openForm}
                      disabled={submitting}
                      className="px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 disabled:opacity-50"
                    >
                      {override ? 'Modifier l’override' : 'Définir un prix magasin'}
                    </button>
                    {override && (
                      <button
                        onClick={handleClear}
                        disabled={submitting}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-bo-text text-sm font-semibold rounded-lg hover:bg-gray-50 disabled:opacity-50"
                      >
                        {submitting ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <RotateCcw size={14} />
                        )}
                        Rétablir le prix de base
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Override form (overlay modal) ── */}
      {formOpen && selected && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-gray-100 p-5 w-full max-w-md mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-bo-text">Prix magasin</h3>
              <button
                onClick={() => setFormOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle size={18} />
              </button>
            </div>
            <p className="text-xs text-bo-muted mb-4">
              {selected.name} · prix de base {fmtMoney(selected.priceMinorUnits)}
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">
                  Prix de vente (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceEuros}
                  onChange={(e) => setPriceEuros(e.target.value)}
                  className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">
                    Début (optionnel)
                  </label>
                  <input
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                    className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">
                    Fin (optionnel)
                  </label>
                  <input
                    type="datetime-local"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                    className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-bo-muted">
                Sans dates, l'override s'applique immédiatement et sans limite.
              </p>
            </div>

            {error && (
              <div className="mt-3 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setFormOpen(false)}
                disabled={submitting}
                className="px-3 py-1.5 border border-gray-200 text-bo-text text-sm font-semibold rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 disabled:opacity-50"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
