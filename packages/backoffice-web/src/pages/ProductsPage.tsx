import React, { useState } from 'react';
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
} from 'lucide-react';

type SortKey = 'name' | 'price' | 'stock' | 'category';
type SortDir = 'asc' | 'desc';

const products = [
  { ean: '3760001000001', name: 'T-Shirt Blanc', price: 29.9, stock: 50, category: 'Haut', image: null },
  { ean: '3760001000002', name: 'Jean Slim Noir', price: 59.9, stock: 30, category: 'Bas', image: null },
  { ean: '3760001000003', name: 'Chaussettes (paire)', price: 8.9, stock: 100, category: 'Accessoire', image: null },
  { ean: '3760001000004', name: 'Veste en Cuir', price: 199.0, stock: 8, category: 'Veste', image: null },
  { ean: '3760001000005', name: 'Echarpe Laine', price: 34.9, stock: 25, category: 'Accessoire', image: null },
  { ean: '3760001000006', name: 'Casquette Sport', price: 19.9, stock: 40, category: 'Accessoire', image: null },
  { ean: '3760001000007', name: 'Sac a Main', price: 89.0, stock: 12, category: 'Accessoire', image: null },
  { ean: '3760001000008', name: 'Ceinture Cuir', price: 24.9, stock: 35, category: 'Accessoire', image: null },
  { ean: '3760001000009', name: 'Pull Marin', price: 45.0, stock: 3, category: 'Haut', image: null },
  { ean: '3760001000010', name: 'Robe d\'ete', price: 64.9, stock: 18, category: 'Robe', image: null },
];

const categories = [...new Set(products.map((p) => p.category))];

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
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

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
  const avgPrice = products.reduce((s, p) => s + p.price, 0) / products.length;

  return (
    <div className="p-8 space-y-6 animate-fade-in">
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
          <button className="flex items-center gap-2 bg-bo-accent text-white px-5 py-2.5 rounded-xl font-medium hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/25">
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
                  key={product.ean}
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
                      <button className="p-2 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-bo-accent transition-colors" title="Modifier">
                        <Pencil size={14} />
                      </button>
                      <button className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="Supprimer">
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
    </div>
  );
}
