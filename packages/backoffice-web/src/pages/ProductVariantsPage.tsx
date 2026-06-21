import { useState, useEffect, useCallback } from 'react';
import {
  Boxes,
  Search,
  Plus,
  Package,
  Loader2,
  X,
  Barcode,
  Tag,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { productsApi } from '../services/api';

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

interface Variant {
  id: string;
  ean: string;
  name: string;
  variantName: string | null;
  sku: string | null;
  priceMinorUnits: number;
  stockQuantity: number;
  parentProductId: string | null;
  active: boolean;
}

function eur(minor: number): string {
  return (minor / 100).toFixed(2) + ' €';
}

export function ProductVariantsPage() {
  // ── Products (left column) ──
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // ── Selected product + its variants (right column) ──
  const [selected, setSelected] = useState<Product | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);

  // ── Create-variant form ──
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ean, setEan] = useState('');
  const [variantName, setVariantName] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');

  // ── Banners ──
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    setError(null);
    try {
      const res = await productsApi.list({ search: search.trim() || undefined });
      const rows: any[] = res.data?.data ?? [];
      // Show only top-level products (filter out rows that are themselves variants).
      const topLevel = rows
        .filter((p: any) => !p.parentProductId)
        .map((p: any) => ({
          id: p.id,
          ean: p.ean ?? '',
          name: p.name ?? '',
          priceMinorUnits: p.priceMinorUnits ?? 0,
          stockQuantity: p.stockQuantity ?? 0,
          parentProductId: p.parentProductId ?? null,
          sku: p.sku ?? null,
          variantName: p.variantName ?? null,
        }));
      setProducts(topLevel);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setLoadingProducts(false);
    }
  }, [search]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const loadVariants = useCallback(async (productId: string) => {
    setLoadingVariants(true);
    setError(null);
    try {
      const res = await productsApi.listVariants(productId);
      const rows: any[] = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      setVariants(
        rows.map((v: any) => ({
          id: v.id,
          ean: v.ean ?? '',
          name: v.name ?? '',
          variantName: v.variantName ?? null,
          sku: v.sku ?? null,
          priceMinorUnits: v.priceMinorUnits ?? 0,
          stockQuantity: v.stockQuantity ?? 0,
          parentProductId: v.parentProductId ?? null,
          active: v.active ?? v.isActive ?? true,
        })),
      );
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
      setVariants([]);
    } finally {
      setLoadingVariants(false);
    }
  }, []);

  const handleSelect = (p: Product) => {
    setSelected(p);
    setFormOpen(false);
    setSuccess(null);
    setError(null);
    loadVariants(p.id);
  };

  const resetForm = () => {
    setEan('');
    setVariantName('');
    setSku('');
    setPrice('');
    setStock('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    setSuccess(null);

    if (!ean.trim()) {
      setError('Le code EAN est obligatoire');
      return;
    }
    if (!variantName.trim()) {
      setError('Le nom de la variante est obligatoire');
      return;
    }
    const parsedPrice = parseFloat(price);
    if (!price.trim() || Number.isNaN(parsedPrice) || parsedPrice < 0) {
      setError('Prix invalide');
      return;
    }

    setSubmitting(true);
    try {
      await productsApi.createVariant(selected.id, {
        ean: ean.trim(),
        variantName: variantName.trim(),
        priceMinorUnits: Math.round(parsedPrice * 100),
        sku: sku.trim() || undefined,
        stockQuantity: stock.trim() ? Math.max(0, parseInt(stock, 10) || 0) : 0,
      });
      setSuccess('Variante créée');
      setFormOpen(false);
      resetForm();
      await loadVariants(selected.id);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-bo-text mb-4 flex items-center gap-2">
        <Boxes size={22} className="text-bo-accent" />
        Variantes / SKU
      </h1>

      {/* Banners */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 size={16} />
          <span>{success}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ── Left: products ── */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="relative mb-3">
            <Search
              size={16}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-bo-muted"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un produit..."
              className="w-full pl-8 pr-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
            />
          </div>

          {loadingProducts ? (
            <div className="flex items-center justify-center py-10 text-bo-muted">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : products.length === 0 ? (
            <div className="py-10 text-center text-sm text-bo-muted">
              <Package size={28} className="mx-auto mb-2 text-gray-300" />
              Aucun produit trouvé
            </div>
          ) : (
            <ul className="space-y-1 max-h-[460px] overflow-y-auto">
              {products.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => handleSelect(p)}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                      selected?.id === p.id
                        ? 'border-bo-accent bg-bo-accent/5'
                        : 'border-transparent hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-semibold text-bo-text">{p.name}</div>
                    <div className="flex items-center gap-3 text-xs text-bo-muted mt-0.5">
                      <span className="flex items-center gap-1">
                        <Barcode size={12} />
                        {p.ean || '—'}
                      </span>
                      <span>{eur(p.priceMinorUnits)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Right: variants ── */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          {!selected ? (
            <div className="py-16 text-center text-sm text-bo-muted">
              <Boxes size={28} className="mx-auto mb-2 text-gray-300" />
              Sélectionnez un produit pour voir ses variantes
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="font-semibold text-bo-text">{selected.name}</h2>
                  <p className="text-xs text-bo-muted">
                    {variants.length} variante{variants.length > 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setFormOpen(true);
                    setError(null);
                    setSuccess(null);
                  }}
                  className="px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 flex items-center gap-1.5"
                >
                  <Plus size={14} />
                  Variante
                </button>
              </div>

              {loadingVariants ? (
                <div className="flex items-center justify-center py-10 text-bo-muted">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : variants.length === 0 ? (
                <div className="py-10 text-center text-sm text-bo-muted">
                  <Tag size={26} className="mx-auto mb-2 text-gray-300" />
                  Aucune variante pour ce produit
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-bo-muted border-b border-gray-100">
                        <th className="py-2 pr-2 font-medium">Variante</th>
                        <th className="py-2 px-2 font-medium">SKU</th>
                        <th className="py-2 px-2 font-medium">EAN</th>
                        <th className="py-2 px-2 font-medium text-right">Prix</th>
                        <th className="py-2 px-2 font-medium text-right">Stock</th>
                        <th className="py-2 pl-2 font-medium text-center">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variants.map((v) => (
                        <tr key={v.id} className="border-b border-gray-50 last:border-0">
                          <td className="py-2 pr-2 font-medium text-bo-text">
                            {v.variantName || v.name || '—'}
                          </td>
                          <td className="py-2 px-2 text-bo-muted font-mono text-xs">
                            {v.sku || '—'}
                          </td>
                          <td className="py-2 px-2 text-bo-muted font-mono text-xs">
                            {v.ean || '—'}
                          </td>
                          <td className="py-2 px-2 text-right text-bo-text">
                            {eur(v.priceMinorUnits)}
                          </td>
                          <td className="py-2 px-2 text-right text-bo-text">
                            {v.stockQuantity}
                          </td>
                          <td className="py-2 pl-2 text-center">
                            {v.active ? (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                                <CheckCircle2 size={13} />
                                Actif
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                                <XCircle size={13} />
                                Inactif
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Create variant modal ── */}
      {formOpen && selected && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-100 p-5 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-bo-text">
                Nouvelle variante — {selected.name}
              </h3>
              <button
                onClick={() => setFormOpen(false)}
                className="text-bo-muted hover:text-bo-text"
                aria-label="Fermer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-bo-muted mb-1">
                  Code EAN *
                </label>
                <input
                  type="text"
                  value={ean}
                  onChange={(e) => setEan(e.target.value)}
                  placeholder="3401597840125"
                  className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-bo-muted mb-1">
                  Nom de la variante *
                </label>
                <input
                  type="text"
                  value={variantName}
                  onChange={(e) => setVariantName(e.target.value)}
                  placeholder="Taille L — Rouge"
                  className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-bo-muted mb-1">
                  SKU (optionnel)
                </label>
                <input
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="TSH-L-RED"
                  className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-bo-muted mb-1">
                    Prix (€) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="9.90"
                    className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-bo-muted mb-1">
                    Stock
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    placeholder="0"
                    className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-3 py-1.5 text-sm font-medium text-bo-muted rounded-lg hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  Créer la variante
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
