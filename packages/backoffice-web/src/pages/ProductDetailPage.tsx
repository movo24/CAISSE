import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Copy, Power, PowerOff, Tag, ListOrdered, Loader2,
  Package, AlertTriangle, XCircle, CheckCircle2,
} from 'lucide-react';
import { productsApi, stockLocationsApi } from '../services/api';

/**
 * Fiche produit — CONSULTATION (lecture seule, /products/:id).
 * En-tête + indicateurs RÉELS (prix TTC/HT, TVA, marge, stock, alertes) et
 * actions (modifier, dupliquer, (dés)activer, étiquette, mouvements, retour).
 * Aucune donnée fictive : tout vient du backend.
 */

const eur = (m: number | null | undefined) =>
  m == null ? '—' : (m / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

const STATUS_LABEL: Record<string, string> = {
  active: 'Actif', draft: 'Brouillon', archived: 'Archivé',
  pending_validation: 'En validation', rejected: 'Rejeté',
};

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<any | null>(null);
  const [brands, setBrands] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; parentId: string | null }>>([]);
  const [movements, setMovements] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [p, b, s, c] = await Promise.all([
        productsApi.get(id),
        productsApi.listBrands(),
        productsApi.listSuppliers(),
        productsApi.listCategories(),
      ]);
      setProduct(p.data);
      setBrands(b.data || []);
      setSuppliers(s.data || []);
      setCategories((c.data || []).map((x: any) => ({ id: x.id, name: x.name, parentId: x.parentId ?? null })));
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Produit introuvable.');
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const brand = brands.find((b) => b.id === product?.brandId);
  const supplier = suppliers.find((s) => s.id === product?.supplierId);

  // Chemin de catégorie (univers › catégorie › sous-catégorie).
  const categoryPath = useMemo(() => {
    if (!product?.categoryId) return null;
    const byId = new Map(categories.map((c) => [c.id, c]));
    const chain: string[] = [];
    let cur = byId.get(product.categoryId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    // Catégorie libre historique non présente dans l'arbre : afficher telle quelle.
    return chain.length ? chain.join(' › ') : String(product.categoryId);
  }, [product, categories]);

  const calc = useMemo(() => {
    if (!product) return null;
    const ttc = product.priceMinorUnits ?? null;
    const rate = Number(product.taxRate ?? 0);
    const ht = ttc != null ? Math.round(ttc / (1 + rate / 100)) : null;
    const tva = ttc != null && ht != null ? ttc - ht : null;
    const cost = product.costMinorUnits ?? null;
    const marge = ht != null && cost != null ? ht - cost : null;
    const tauxMarque = marge != null && ht ? (marge / ht) * 100 : null;
    const tauxMarge = marge != null && cost ? (marge / cost) * 100 : null;
    return { ttc, rate, ht, tva, cost, marge, tauxMarque, tauxMarge };
  }, [product]);

  const stock = product?.stockQuantity ?? 0;
  const alertT = product?.stockAlertThreshold ?? 10;
  const critT = product?.stockCriticalThreshold ?? 5;
  const stockLevel = stock <= critT ? 'critical' : stock <= alertT ? 'alert' : 'ok';

  const toggleActive = async () => {
    if (!product) return;
    const activate = !product.isActive;
    setBusy(true);
    setError(null);
    try {
      await productsApi.update(product.id, { status: activate ? 'active' : 'archived' });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Action impossible.');
    } finally {
      setBusy(false);
    }
  };

  const loadMovements = async () => {
    if (!id) return;
    try {
      const r = await stockLocationsApi.productMovements(id);
      setMovements(Array.isArray(r.data) ? r.data : (r.data?.data || []));
    } catch {
      setMovements([]);
    }
  };

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-gray-300" /></div>;
  if (error && !product) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <button onClick={() => navigate('/products')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"><ArrowLeft size={15} /> Catalogue</button>
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      </div>
    );
  }
  if (!product) return null;

  const metrics: Array<[string, string]> = [
    ['Prix TTC', eur(calc?.ttc)],
    ['Prix HT', eur(calc?.ht)],
    ['TVA', `${calc?.rate ?? 0} %  (${eur(calc?.tva)})`],
    ["Prix d'achat", eur(calc?.cost)],
    ['Marge HT', calc?.marge != null ? `${eur(calc.marge)}${calc.tauxMarque != null ? ` · ${calc.tauxMarque.toFixed(1)} %` : ''}` : '—'],
    ['Stock disponible', String(stock)],
  ];

  return (
    <div className="p-6 lg:p-8 space-y-5 animate-fade-in max-w-[1100px] mx-auto">
      <button onClick={() => navigate('/products')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={15} /> Catalogue</button>

      {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {/* En-tête fiche */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-soft p-6">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="w-32 h-32 rounded-xl border border-gray-100 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
            {product.imageUrl
              ? <img src={product.imageUrl} alt="" className="max-h-full max-w-full object-contain" />
              : <Package size={40} className="text-gray-300" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-bo-text truncate">{product.name}</h1>
                <p className="text-xs text-gray-400 font-mono mt-1">
                  EAN {product.ean}{product.sku && ` · SKU ${product.sku}`}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${product.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                {product.isActive ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {STATUS_LABEL[product.status] || (product.isActive ? 'Actif' : 'Inactif')}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 mt-4 text-sm">
              <div><p className="text-[11px] font-semibold text-gray-400">Marque</p><p className="text-gray-700">{brand?.name || '—'}</p></div>
              <div><p className="text-[11px] font-semibold text-gray-400">Catégorie</p><p className="text-gray-700">{categoryPath || '—'}</p></div>
              <div><p className="text-[11px] font-semibold text-gray-400">Fournisseur</p><p className="text-gray-700">{supplier?.name || '—'}</p></div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap mt-6 pt-5 border-t border-gray-100">
          <button onClick={() => navigate(`/products/${product.id}/edit`)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-bo-accent text-white text-sm font-semibold hover:bg-bo-accent/90"><Pencil size={15} /> Modifier</button>
          <button onClick={() => navigate(`/products/new?from=${product.id}`)} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"><Copy size={15} /> Dupliquer</button>
          <button onClick={toggleActive} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : product.isActive ? <PowerOff size={15} /> : <Power size={15} />}
            {product.isActive ? 'Désactiver' : 'Réactiver'}
          </button>
          <button onClick={() => navigate('/labels')} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"><Tag size={15} /> Imprimer une étiquette</button>
          <button onClick={loadMovements} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"><ListOrdered size={15} /> Consulter les mouvements</button>
        </div>
      </div>

      {/* Indicateurs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {metrics.map(([label, value]) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-soft px-4 py-3">
            <p className="text-[11px] font-semibold text-gray-400">{label}</p>
            <p className="text-lg font-bold text-bo-text tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {/* Alerte stock */}
      {stockLevel !== 'ok' && (
        <div className={`rounded-xl px-4 py-3 text-sm flex items-center gap-2 ${stockLevel === 'critical' ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
          <AlertTriangle size={16} className="shrink-0" />
          {stockLevel === 'critical'
            ? `Stock critique : ${stock} (seuil critique ${critT}).`
            : `Stock bas : ${stock} (seuil d'alerte ${alertT}).`}
        </div>
      )}

      {/* Mouvements (à la demande) */}
      {movements !== null && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-soft p-5">
          <p className="text-sm font-bold text-bo-text mb-3">Mouvements de stock</p>
          {movements.length === 0 ? (
            <p className="text-sm text-gray-400">Aucun mouvement journalisé pour ce produit (réceptions / transferts / pertes).</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100"><th className="py-2">Date</th><th>Type</th><th className="text-right">Qté</th><th>Réf.</th><th>Motif</th></tr></thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-gray-50">
                    <td className="py-2 text-gray-600">{m.createdAt ? new Date(m.createdAt).toLocaleString('fr-FR') : '—'}</td>
                    <td className="text-gray-700">{m.movementType}</td>
                    <td className="text-right tabular-nums">{m.quantity}</td>
                    <td className="font-mono text-xs text-gray-400">{m.reference || '—'}</td>
                    <td className="text-xs text-gray-500">{m.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
