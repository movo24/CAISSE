import { useState, useEffect, useCallback } from 'react';
import {
  Tags,
  Truck,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { productsApi } from '../services/api';

interface Brand {
  id: string;
  name: string;
}

interface Supplier {
  id: string;
  name: string;
}

export function BrandsSuppliersPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const [brandName, setBrandName] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [brandSubmitting, setBrandSubmitting] = useState(false);
  const [supplierSubmitting, setSupplierSubmitting] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [brandsRes, suppliersRes] = await Promise.all([
        productsApi.listBrands(),
        productsApi.listSuppliers(),
      ]);
      setBrands(
        (brandsRes.data || []).map((b: any) => ({ id: b.id, name: b.name })),
      );
      setSuppliers(
        (suppliersRes.data || []).map((s: any) => ({ id: s.id, name: s.name })),
      );
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 2000);
  };

  const handleAddBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = brandName.trim();
    if (!name) {
      setError('Le nom de la marque est obligatoire');
      return;
    }
    setBrandSubmitting(true);
    setError(null);
    try {
      // Dedup is server-side — re-fetch and display the returned list.
      await productsApi.createBrand(name);
      const res = await productsApi.listBrands();
      setBrands((res.data || []).map((b: any) => ({ id: b.id, name: b.name })));
      setBrandName('');
      flashSuccess('Marque ajoutée');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setBrandSubmitting(false);
    }
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = supplierName.trim();
    if (!name) {
      setError('Le nom du fournisseur est obligatoire');
      return;
    }
    setSupplierSubmitting(true);
    setError(null);
    try {
      // Dedup is server-side — re-fetch and display the returned list.
      await productsApi.createSupplier(name);
      const res = await productsApi.listSuppliers();
      setSuppliers(
        (res.data || []).map((s: any) => ({ id: s.id, name: s.name })),
      );
      setSupplierName('');
      flashSuccess('Fournisseur ajouté');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setSupplierSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-bo-text mb-4 flex items-center gap-2">
        <Tags size={22} className="text-bo-accent" />
        Marques & fournisseurs
      </h1>
      <p className="text-sm text-bo-muted mb-4">
        Référentiel partagé des marques et des fournisseurs. Les doublons sont
        dédupliqués automatiquement côté serveur.
      </p>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={16} className="shrink-0" /> {success}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-bo-accent" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Marques */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Tags size={18} className="text-bo-accent" />
              <h2 className="text-base font-bold text-bo-text">Marques</h2>
              <span className="ml-auto text-xs font-semibold text-bo-muted bg-gray-50 px-2 py-0.5 rounded-full">
                {brands.length}
              </span>
            </div>

            <form onSubmit={handleAddBrand} className="flex items-center gap-2 mb-4">
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Nom de la marque"
                disabled={brandSubmitting}
                className="flex-1 px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
              />
              <button
                type="submit"
                disabled={brandSubmitting || !brandName.trim()}
                className="px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {brandSubmitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                Ajouter
              </button>
            </form>

            {brands.length === 0 ? (
              <div className="text-center py-10 text-bo-muted">
                <Tags size={36} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Aucune marque</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {brands.map((b) => (
                  <li
                    key={b.id}
                    className="py-2 text-sm text-bo-text flex items-center gap-2"
                  >
                    <Tags size={14} className="text-bo-muted shrink-0" />
                    {b.name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Fournisseurs */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Truck size={18} className="text-bo-accent" />
              <h2 className="text-base font-bold text-bo-text">Fournisseurs</h2>
              <span className="ml-auto text-xs font-semibold text-bo-muted bg-gray-50 px-2 py-0.5 rounded-full">
                {suppliers.length}
              </span>
            </div>

            <form
              onSubmit={handleAddSupplier}
              className="flex items-center gap-2 mb-4"
            >
              <input
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Nom du fournisseur"
                disabled={supplierSubmitting}
                className="flex-1 px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
              />
              <button
                type="submit"
                disabled={supplierSubmitting || !supplierName.trim()}
                className="px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {supplierSubmitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                Ajouter
              </button>
            </form>

            {suppliers.length === 0 ? (
              <div className="text-center py-10 text-bo-muted">
                <Truck size={36} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Aucun fournisseur</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {suppliers.map((s) => (
                  <li
                    key={s.id}
                    className="py-2 text-sm text-bo-text flex items-center gap-2"
                  >
                    <Truck size={14} className="text-bo-muted shrink-0" />
                    {s.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
