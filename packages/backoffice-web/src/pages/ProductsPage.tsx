import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Plus,
  Package,
  Pencil,
  Trash2,
  ArrowUpDown,
  Filter,
  Download,
  Upload,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  X,
} from 'lucide-react';
import { productsApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useCurrentStoreId } from '../hooks/useCurrentStoreId';
import { PriceAnalyticsPanel } from '../components/PriceAnalyticsPanel';

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
  const storeId = useCurrentStoreId();
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

  // Price analytics panel
  const [analyticsProductId, setAnalyticsProductId] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await productsApi.list({ storeId });
      const data: any[] = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.products || []);
      setProducts(
        data.map((p: any) => ({
          id: p.id,
          ean: p.ean || '',
          name: p.name || '',
          price: (p.priceMinorUnits || 0) / 100,
          stock: p.stockQuantity ?? 0,
          category: typeof p.categoryId === 'string' ? p.categoryId : (typeof p.category === 'string' ? p.category : 'Non classe'),
          image: p.imageUrl || null,
        })),
      );
      setError(null);
    } catch (err: any) {
      const msg = err.response?.data?.message;
      setError(typeof msg === 'string' ? msg : Array.isArray(msg) ? msg.join(', ') : 'Erreur lors du chargement des produits');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

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

  /* ── Onboarding catalogue (PR #29) — import CSV serveur + modèle round-trip ── */
  interface ImportReport {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ line: number; ean: string; reason: string }>;
  }
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleImportFile = async (file: File) => {
    setImporting(true);
    setImportError(null);
    try {
      const csv = await file.text();
      const res = await productsApi.importCsv(csv);
      // Rapport honnête par ligne : rien n'est silencieusement ignoré.
      setImportReport(res.data as ImportReport);
      await fetchProducts(); // le catalogue affiché reflète l'état réel post-import
    } catch (err: any) {
      setImportError(err?.response?.data?.message || err?.message || 'Import impossible');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  /** Modèle/export canonique SERVEUR — round-trippable avec l'import (colonnes officielles). */
  const handleExportServerCsv = async () => {
    try {
      const res = await productsApi.exportCsv();
      const blob = new Blob(['﻿' + (res.data as string)], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `catalogue-import-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setImportError(err?.response?.data?.message || 'Export serveur impossible');
    }
  };

  const handleExportCsv = () => {
    if (filtered.length === 0) return;
    const header = ['Nom', 'EAN', 'Categorie', 'Prix (EUR)', 'Stock'];
    const rows = filtered.map((p) => [p.name, p.ean, p.category, p.price.toFixed(2), String(p.stock)]);
    const escapeCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
    // Prepend BOM so Excel detects UTF-8
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `produits-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const resetForm = () => {
    setForm({ name: '', ean: '', price: '', stock: '', category: '' });
    setEditingId(null);
  };

  const openAdd = () => { resetForm(); setShowModal(true); };

  const [originalPrice, setOriginalPrice] = useState<number | null>(null);
  const [priceConfirm, setPriceConfirm] = useState(false);

  const openEdit = (p: Product) => {
    setForm({
      name: p.name,
      ean: p.ean,
      price: String(p.price),
      stock: String(p.stock),
      category: p.category,
    });
    setOriginalPrice(p.price);
    setEditingId(p.id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;

    // Price change confirmation for edits
    const newPrice = Math.round(parseFloat(form.price || '0') * 100);
    if (editingId && originalPrice !== null) {
      const oldPriceCents = Math.round(originalPrice * 100);
      if (oldPriceCents !== newPrice && !priceConfirm) {
        setPriceConfirm(true);
        return;
      }
    }
    setPriceConfirm(false);

    try {
      setSaving(true);
      const payload = {
        name: form.name,
        ean: form.ean,
        price: newPrice,
        stock: parseInt(form.stock || '0', 10),
        category: form.category,
        storeId,
      };
      if (editingId) {
        await productsApi.update(editingId, payload);
      } else {
        await productsApi.create(payload);
      }
      setShowModal(false);
      setOriginalPrice(null);
      resetForm();
      await fetchProducts();
    } catch (err: any) {
      const rawMsg = err.response?.data?.message;
      const msg = typeof rawMsg === 'string' ? rawMsg : Array.isArray(rawMsg) ? rawMsg.join(', ') : 'Erreur lors de la sauvegarde';
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
      const delMsg = err.response?.data?.message;
      alert(typeof delMsg === 'string' ? delMsg : Array.isArray(delMsg) ? delMsg.join(', ') : 'Erreur lors de la suppression');
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
            Réessayer
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
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); }}
          />
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            title="Importer / mettre à jour le catalogue depuis un CSV (colonnes du modèle serveur)"
          >
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {importing ? 'Import...' : 'Importer CSV'}
          </button>
          <button
            onClick={handleExportServerCsv}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            title="Télécharger le catalogue au format d'import (modèle round-trip serveur)"
          >
            <Download size={16} />
            Modèle / Export serveur
          </button>
          <button
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            title="Exporter les produits filtrés en CSV"
          >
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
                <React.Fragment key={product.id}>
                <tr
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
                        onClick={() => setAnalyticsProductId(analyticsProductId === product.id ? null : product.id)}
                        className={`p-2 rounded-lg transition-colors ${analyticsProductId === product.id ? 'bg-indigo-100 text-bo-accent' : 'hover:bg-indigo-50 text-gray-400 hover:text-bo-accent'}`}
                        title="Historique tarifaire"
                      >
                        <BarChart3 size={14} />
                      </button>
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
                {/* Price analytics expandable row */}
                {analyticsProductId === product.id && (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <div className="px-6 py-4 bg-bo-subtle/50 border-b border-bo-border animate-fade-in">
                        <PriceAnalyticsPanel productId={product.id} />
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
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
          <div className="relative bg-white rounded-2xl shadow-elevated w-full max-w-lg p-6 animate-slide-up max-h-[88vh] overflow-y-auto">
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

              {/* Pack / produit composé (GO owner 2026-07-09) — édition seulement :
                  le produit doit exister pour porter une composition. */}
              {editingId && <PackComponentsSection productId={editingId} storeId={storeId} />}
            </div>

            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
              {/* Price change confirmation */}
              {priceConfirm && originalPrice !== null && (
                <div className="flex-1 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-xs">
                  <p className="font-bold text-amber-800 mb-1">⚠️ Modification de prix détectée</p>
                  <p className="text-amber-700">
                    Ancien : <strong>{originalPrice.toFixed(2)} €</strong> → Nouveau : <strong>{parseFloat(form.price || '0').toFixed(2)} €</strong>
                    {' '}({((parseFloat(form.price || '0') - originalPrice) / originalPrice * 100).toFixed(1)}%)
                  </p>
                  <p className="text-amber-600 mt-1">Cliquez à nouveau sur "Enregistrer" pour confirmer.</p>
                </div>
              )}
              <button
                onClick={() => { setShowModal(false); setPriceConfirm(false); setOriginalPrice(null); resetForm(); }}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim() || saving}
                className={`px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-colors shadow-lg disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 ${
                  priceConfirm ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/25' : 'bg-bo-accent hover:bg-bo-accent/90 shadow-bo-accent/25'
                }`}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {priceConfirm ? 'Confirmer le changement de prix' : editingId ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Rapport d'import CSV (PR #29) — honnête, ligne par ligne ═══ */}
      {importError && (
        <div className="fixed bottom-6 right-6 z-50 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm shadow-lg flex items-center gap-3">
          <XCircle size={16} />
          {importError}
          <button onClick={() => setImportError(null)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
        </div>
      )}
      {importReport && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-bo-text">Rapport d'import catalogue</h3>
              <button onClick={() => setImportReport(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-4 gap-3 px-6 py-4">
              <div className="rounded-xl bg-gray-50 p-3 text-center">
                <p className="text-2xl font-black text-bo-text">{importReport.total}</p>
                <p className="text-xs text-gray-500">Lignes lues</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3 text-center">
                <p className="text-2xl font-black text-emerald-600">{importReport.created}</p>
                <p className="text-xs text-emerald-600">Créés</p>
              </div>
              <div className="rounded-xl bg-indigo-50 p-3 text-center">
                <p className="text-2xl font-black text-indigo-600">{importReport.updated}</p>
                <p className="text-xs text-indigo-600">Mis à jour</p>
              </div>
              <div className={`rounded-xl p-3 text-center ${importReport.skipped > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                <p className={`text-2xl font-black ${importReport.skipped > 0 ? 'text-red-600' : 'text-gray-400'}`}>{importReport.skipped}</p>
                <p className={`text-xs ${importReport.skipped > 0 ? 'text-red-600' : 'text-gray-500'}`}>Ignorés (erreur)</p>
              </div>
            </div>
            {importReport.errors.length > 0 && (
              <div className="px-6 pb-4 overflow-y-auto">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Lignes en erreur — aucune n'a été importée silencieusement</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="py-1.5 pr-3">Ligne</th>
                      <th className="py-1.5 pr-3">EAN</th>
                      <th className="py-1.5">Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importReport.errors.map((e) => (
                      <tr key={`imp-err-${e.line}`} className="border-b border-gray-50">
                        <td className="py-1.5 pr-3 font-mono text-gray-500">{e.line}</td>
                        <td className="py-1.5 pr-3 font-mono">{e.ean || '—'}</td>
                        <td className="py-1.5 text-red-600">{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-6 py-4 border-t border-gray-100 text-right">
              <button
                onClick={() => setImportReport(null)}
                className="px-5 py-2.5 rounded-xl text-sm font-medium bg-bo-accent text-white hover:bg-bo-accent/90"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Message serveur affiché VERBATIM (BadRequest anti-boucle, conflit, etc.). */
function serverMsg(e: any): string {
  const m = e?.response?.data?.message;
  return typeof m === 'string' ? m : Array.isArray(m) ? m.join(', ') : 'Erreur serveur';
}

/**
 * Pack / produit composé (GO owner 2026-07-09).
 * Le produit ÉDITÉ est le parent (facturé, une seule ligne ticket) ; chaque
 * composant listé ici sort du stock automatiquement à la vente. La composition
 * est modifiable librement : les ventes passées gardent leur snapshot.
 */
function PackComponentsSection({ productId, storeId }: { productId: string; storeId?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await productsApi.listComponents(productId);
      const data = Array.isArray(res.data) ? res.data : [];
      setRows(data);
      if (data.length > 0) setOpen(true);
      setError(null);
    } catch (e: any) {
      setError(serverMsg(e));
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  // Recherche serveur (mêmes params que la liste produits), débouncée.
  useEffect(() => {
    if (!adding) return;
    const t = setTimeout(async () => {
      try {
        const res = await productsApi.list({ storeId, search: query.trim() || undefined, limit: 8 });
        const data: any[] = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.products || []);
        setResults(data.filter((p) => p.id !== productId));
      } catch {
        /* recherche silencieuse — l'erreur bloquante viendra de l'ajout */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [adding, query, storeId, productId]);

  const addComponent = async () => {
    if (!selected) return;
    const q = parseInt(qty, 10);
    if (!Number.isInteger(q) || q <= 0) { setError('La quantité doit être un entier strictement positif.'); return; }
    try {
      setBusy(true);
      await productsApi.addComponent(productId, { componentProductId: selected.id, quantityPerParent: q });
      setSelected(null); setQuery(''); setQty('1'); setAdding(false); setError(null);
      await load();
    } catch (e: any) {
      setError(serverMsg(e)); // anti-boucle / doublon affichés tels quels
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row: any) => {
    try {
      setBusy(true);
      await productsApi.updateComponent(productId, row.id, { isActive: !row.isActive });
      setError(null);
      await load();
    } catch (e: any) { setError(serverMsg(e)); } finally { setBusy(false); }
  };

  const saveQty = async (row: any, value: string) => {
    const q = parseInt(value, 10);
    if (!Number.isInteger(q) || q <= 0 || q === row.quantityPerParent) return;
    try {
      setBusy(true);
      await productsApi.updateComponent(productId, row.id, { quantityPerParent: q });
      setError(null);
      await load();
    } catch (e: any) { setError(serverMsg(e)); } finally { setBusy(false); }
  };

  const remove = async (row: any) => {
    if (!confirm(`Retirer « ${row.componentName ?? row.componentProductId} » de la composition ?\n(Les ventes passées gardent leur composition d'origine.)`)) return;
    try {
      setBusy(true);
      await productsApi.removeComponent(productId, row.id);
      setError(null);
      await load();
    } catch (e: any) { setError(serverMsg(e)); } finally { setBusy(false); }
  };

  const hasComponents = rows.length > 0;

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-bo-text">Pack / produit composé</p>
          <p className="text-xs text-gray-400">Ce produit contient d'autres produits (inclus dans son prix)</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          disabled={hasComponents}
          title={hasComponents ? 'Composition existante — retirez les composants pour masquer' : ''}
          className={`relative w-11 h-6 rounded-full transition-colors ${open ? 'bg-bo-accent' : 'bg-gray-200'} ${hasComponents ? 'opacity-70' : ''}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${open ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
              <XCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <p className="text-xs text-gray-400 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Chargement de la composition…</p>
          ) : hasComponents ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 text-left">
                  <th className="py-1 font-medium">Composant</th>
                  <th className="py-1 font-medium w-20">Qté / unité</th>
                  <th className="py-1 font-medium w-16">Statut</th>
                  <th className="py-1 w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100">
                    <td className="py-2 pr-2">
                      <p className={`font-medium ${row.isActive ? 'text-bo-text' : 'text-gray-400 line-through'}`}>{row.componentName ?? '(produit supprimé)'}</p>
                      <p className="text-gray-400 font-mono">{row.componentEan}</p>
                    </td>
                    <td className="py-2">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        defaultValue={row.quantityPerParent}
                        onBlur={(e) => saveQty(row, e.target.value)}
                        disabled={busy}
                        className="w-16 px-2 py-1 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                      />
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => toggleActive(row)}
                        disabled={busy}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium ${row.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}
                      >
                        {row.isActive ? 'Actif' : 'Inactif'}
                      </button>
                    </td>
                    <td className="py-2 text-right">
                      <button type="button" onClick={() => remove(row)} disabled={busy} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-gray-400">Aucun composant — ce produit se vend seul pour l'instant.</p>
          )}

          {adding ? (
            <div className="rounded-xl bg-gray-50 p-3 space-y-2">
              <input
                type="text"
                autoFocus
                placeholder="Rechercher un produit existant (nom ou EAN)…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
              />
              {!selected && results.length > 0 && (
                <ul className="max-h-36 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                  {results.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => { setSelected(p); setQuery(p.name); }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
                      >
                        <span className="font-medium text-bo-text">{p.name}</span>
                        <span className="ml-2 text-gray-400 font-mono">{p.ean}</span>
                        <span className="ml-2 text-gray-400">stock {p.stockQuantity ?? 0}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Quantité consommée par unité vendue :</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-16 px-2 py-1 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                />
                <div className="flex-1" />
                <button type="button" onClick={() => { setAdding(false); setSelected(null); setQuery(''); }} className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100">
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={addComponent}
                  disabled={!selected || busy}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-bo-accent disabled:opacity-40 flex items-center gap-1.5"
                >
                  {busy && <Loader2 size={11} className="animate-spin" />}
                  Ajouter au pack
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setAdding(true); setResults([]); setQuery(''); }}
              className="flex items-center gap-1.5 text-xs font-medium text-bo-accent hover:underline"
            >
              <Plus size={13} /> Ajouter un composant
            </button>
          )}
        </div>
      )}
    </div>
  );
}
