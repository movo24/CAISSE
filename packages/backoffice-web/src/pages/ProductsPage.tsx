import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Plus,
  Package,
  Pencil,
  Trash2,
  ArrowUpDown,
  Filter,
  Download,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  X,
} from 'lucide-react';
import { productsApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';

type SortKey = 'name' | 'price' | 'stock' | 'category';
type SortDir = 'asc' | 'desc';

interface Product {
  id: string;
  ean: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  image: string | null;
}

const avatarColors = [
  'from-indigo-100 to-indigo-200 text-indigo-600',
  'from-rose-100 to-rose-200 text-rose-600',
  'from-emerald-100 to-emerald-200 text-emerald-600',
  'from-amber-100 to-amber-200 text-amber-600',
  'from-cyan-100 to-cyan-200 text-cyan-600',
  'from-violet-100 to-violet-200 text-violet-600',
  'from-pink-100 to-pink-200 text-pink-600',
  'from-teal-100 to-teal-200 text-teal-600',
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function stockBadge(stock: number) {
  if (stock <= 5) return { color: 'bg-red-50 text-red-600 ring-red-200', icon: XCircle, label: 'Critique' };
  if (stock <= 15) return { color: 'bg-amber-50 text-amber-600 ring-amber-200', icon: AlertTriangle, label: 'Faible' };
  return { color: 'bg-emerald-50 text-emerald-600 ring-emerald-200', icon: CheckCircle2, label: 'OK' };
}

export function ProductsPage() {
  const employee = useAuthStore((s) => s.employee);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', ean: '', price: '', stock: '', category: '' });

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      const storeId = employee?.storeId;
      const res = await productsApi.list(storeId);
      const data: any[] = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.products || []);
      setProducts(
        data.map((p: any) => ({
          id: p.id,
          ean: p.ean || p.barcode || '',
          name: p.name || '',
          price: typeof p.price === 'number' ? p.price / 100 : (p.priceHT || p.priceTTC || 0),
          stock: p.stock ?? p.quantity ?? 0,
          category: p.category || 'Non classe',
          image: p.image || null,
        })),
      );
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur lors du chargement des produits');
    } finally {
      setLoading(false);
    }
  }, [employee?.storeId]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const categories = [...new Set(products.map((p) => p.category))];

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const filtered = products
    .filter((p) => {
      const matchSearch =
        p.name.toLowerCase().includes(search.toLowerCase()) || p.ean.includes(search);
      const matchCat = filterCat === 'all' || p.category === filterCat;
      return matchSearch && matchCat;
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      if (sortKey === 'price') return (a.price - b.price) * dir;
      if (sortKey === 'stock') return (a.stock - b.stock) * dir;
      if (sortKey === 'category') return a.category.localeCompare(b.category) * dir;
      return 0;
    });

  const totalStock = products.reduce((s, p) => s + p.stock, 0);
  const lowStock = products.filter((p) => p.stock <= 15).length;
  const avgPrice = products.length > 0 ? products.reduce((s, p) => s + p.price, 0) / products.length : 0;

  const resetForm = () => {
    setForm({ name: '', ean: '', price: '', stock: '', category: '' });
    setEditingId(null);
  };

  const openAdd = () => { resetForm(); setShowModal(true); };

  const openEdit = (p: Product) => {
    setForm({
      name: p.name,
      ean: p.ean,
      price: String(p.price),
      stock: String(p.stock),
      category: p.category,
    });
    setEditingId(p.id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    try {
      setSaving(true);
      const payload = {
        name: form.name,
        ean: form.ean,
        price: Math.round(parseFloat(form.price || '0') * 100),
        stock: parseInt(form.stock || '0', 10),
        category: form.category,
        storeId: employee?.storeId,
      };
      if (editingId) {
        await productsApi.update(editingId, payload);
      } else {
        await productsApi.create(payload);
      }
      setShowModal(false);
      resetForm();
      await fetchProducts();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Erreur lors de la sauvegarde';
      alert(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce produit ?')) return;
    try {
      await productsApi.delete(id);
      await fetchProducts();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Erreur lors de la suppression');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 size={32} className="animate-spin text-bo-accent" />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchProducts} className="text-red-600 font-medium hover:underline">
            Reessayer
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-bo-text">Catalogue Produits</h2>
          <p className="text-gray-400 mt-1 text-sm">
            {products.length} references en catalogue
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <Download size={16} />
            Exporter
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-bo-accent text-white px-5 py-2.5 rounded-xl font-medium hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/25"
          >
            <Plus size={16} />
            Nouveau produit
          </button>
        </div>
      </div>

      {/* Stats mini */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total references', value: String(products.length), icon: Package, color: 'text-bo-accent bg-indigo-50' },
          { label: 'Stock total', value: totalStock.toLocaleString('fr-FR'), icon: BarChart3, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Alertes stock', value: String(lowStock), icon: AlertTriangle, color: 'text-amber-600 bg-amber-50' },
          { label: 'Prix moyen', value: `${avgPrice.toFixed(2)} \u20ac`, icon: ArrowUpDown, color: 'text-cyan-600 bg-cyan-50' },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-2xl p-4 shadow-soft border border-gray-100/50 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}>
                <Icon size={18} />
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium">{s.label}</p>
                <p className="text-lg font-bold text-bo-text">{s.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher par nom ou code EAN..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="relative">
          <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <select
            className="pl-8 pr-8 py-2.5 rounded-xl border border-gray-200 bg-white text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
          >
            <option value="all">Toutes categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-soft border border-gray-100/50 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider w-12">
                #
              </th>
              <th className="text-left py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Produit
              </th>
              <th
                className="text-left py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-bo-accent transition-colors"
                onClick={() => toggleSort('category')}
              >
                <span className="flex items-center gap-1">
                  Categorie
                  <ArrowUpDown size={12} />
                </span>
              </th>
              <th className="text-left py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                EAN
              </th>
              <th
                className="text-right py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-bo-accent transition-colors"
                onClick={() => toggleSort('price')}
              >
                <span className="flex items-center justify-end gap-1">
                  Prix
                  <ArrowUpDown size={12} />
                </span>
              </th>
              <th
                className="text-right py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-bo-accent transition-colors"
                onClick={() => toggleSort('stock')}
              >
                <span className="flex items-center justify-end gap-1">
                  Stock
                  <ArrowUpDown size={12} />
                </span>
              </th>
              <th className="text-right py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((product, idx) => {
              const badge = stockBadge(product.stock);
              const BadgeIcon = badge.icon;
              return (
                <tr
                  key={product.id}
                  className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors group"
                >
                  <td className="py-3 px-4 text-xs text-gray-300 font-mono">{idx + 1}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${avatarColor(product.name)} flex items-center justify-center font-bold text-sm flex-shrink-0`}>
                        {product.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-bo-text">{product.name}</p>
                        <p className="text-[11px] text-gray-400">{product.category}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-xs font-medium px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600">
                      {product.category}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-gray-400">
                    {product.ean}
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-sm">
                    {product.price.toFixed(2).replace('.', ',')} &euro;
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ring-1 ${badge.color}`}>
                      <BadgeIcon size={12} />
                      {product.stock}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit(product)}
                        className="p-2 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-bo-accent transition-colors"
                        title="Modifier"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(product.id)}
                        className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="py-12 text-center">
            <Package size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400 text-sm">Aucun produit ne correspond a votre recherche</p>
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
          <span>{filtered.length} produit{filtered.length > 1 ? 's' : ''} affiche{filtered.length > 1 ? 's' : ''}</span>
          <span>Catalogue produits</span>
        </div>
      </div>

      {/* Modal Add/Edit Product */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setShowModal(false); resetForm(); }} />
          <div className="relative bg-white rounded-2xl shadow-elevated w-full max-w-lg p-6 animate-slide-up">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-bo-text">
                {editingId ? 'Modifier le produit' : 'Nouveau produit'}
              </h3>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Nom du produit *</label>
                <input
                  type="text"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                  placeholder="T-Shirt Blanc"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Code EAN</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                    placeholder="3760001000001"
                    value={form.ean}
                    onChange={(e) => setForm({ ...form, ean: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Categorie</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                    placeholder="Haut"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Prix TTC (EUR)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                    placeholder="29.90"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Stock</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                    placeholder="50"
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim() || saving}
                className="px-5 py-2.5 rounded-xl text-sm font-medium bg-bo-accent text-white hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingId ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
