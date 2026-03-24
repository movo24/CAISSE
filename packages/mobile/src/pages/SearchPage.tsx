// ── SearchPage ───────────────────────────────────────────────────
// Browse + Search: shows ALL products by default with sort + filters
// Search filters the list in real-time (never empty screen)
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search, Package, BarChart3, AlertTriangle, Tag, X,
  ArrowUpDown, Filter, AlertCircle,
} from 'lucide-react';
import { productsApi } from '../services/api';
import { ProductCard } from '../components/ProductCard';

interface Product {
  id: string;
  name: string;
  ean?: string;
  categoryId?: string;
  priceMinorUnits: number;
  imageUrl?: string;
  stockQuantity: number;
  stockAlertThreshold?: number;
}

type SortKey = 'name_asc' | 'name_desc' | 'recent' | 'oldest' | 'stock_low' | 'price_asc' | 'price_desc';
type StockFilter = 'all' | 'out' | 'low' | 'ok';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name_asc', label: 'A → Z' },
  { value: 'name_desc', label: 'Z → A' },
  { value: 'stock_low', label: 'Stock faible' },
  { value: 'price_asc', label: 'Prix ↑' },
  { value: 'price_desc', label: 'Prix ↓' },
  { value: 'recent', label: 'Récents' },
];

const STOCK_FILTERS: { value: StockFilter; label: string; color: string }[] = [
  { value: 'all', label: 'Tous', color: 'bg-gray-100 text-gray-600' },
  { value: 'out', label: 'Rupture', color: 'bg-red-100 text-red-600' },
  { value: 'low', label: 'Faible', color: 'bg-amber-100 text-amber-600' },
  { value: 'ok', label: 'OK', color: 'bg-emerald-100 text-emerald-600' },
];

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [sort, setSort] = useState<SortKey>('name_asc');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [showSort, setShowSort] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load all products on mount
  useEffect(() => {
    setLoading(true);
    productsApi
      .list()
      .then((res) => {
        const products = res.data?.data || res.data || [];
        setAllProducts(products);
        setLoaded(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Filtered + sorted list (always visible)
  const displayProducts = useMemo(() => {
    let list = [...allProducts];

    // Text search filter
    if (query.trim()) {
      const q = query.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.ean?.toLowerCase().includes(q) ||
          p.categoryId?.toLowerCase().includes(q),
      );
    }

    // Stock filter
    if (stockFilter === 'out') {
      list = list.filter((p) => p.stockQuantity <= 0);
    } else if (stockFilter === 'low') {
      list = list.filter(
        (p) =>
          p.stockQuantity > 0 &&
          p.stockAlertThreshold != null &&
          p.stockQuantity <= p.stockAlertThreshold,
      );
    } else if (stockFilter === 'ok') {
      list = list.filter(
        (p) =>
          p.stockAlertThreshold == null || p.stockQuantity > p.stockAlertThreshold,
      );
    }

    // Sort
    switch (sort) {
      case 'name_asc':
        list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        break;
      case 'name_desc':
        list.sort((a, b) => b.name.localeCompare(a.name, 'fr'));
        break;
      case 'stock_low':
        list.sort((a, b) => a.stockQuantity - b.stockQuantity);
        break;
      case 'price_asc':
        list.sort((a, b) => a.priceMinorUnits - b.priceMinorUnits);
        break;
      case 'price_desc':
        list.sort((a, b) => b.priceMinorUnits - a.priceMinorUnits);
        break;
      case 'recent':
        list.reverse(); // Most recent = last added = end of array
        break;
      case 'oldest':
        break; // Default order
    }

    return list;
  }, [allProducts, query, sort, stockFilter]);

  const outOfStockCount = allProducts.filter((p) => p.stockQuantity <= 0).length;
  const lowStockCount = allProducts.filter(
    (p) => p.stockQuantity > 0 && p.stockAlertThreshold != null && p.stockQuantity <= p.stockAlertThreshold,
  ).length;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-mobile-bg safe-top">
      {/* Search header */}
      <div className="px-4 pt-4 pb-2 bg-white border-b border-mobile-border/40">
        <div className="relative mb-3">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mobile-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom, EAN, catégorie..."
            className="w-full pl-11 pr-10 py-3 rounded-2xl bg-gray-50 border border-mobile-border/40 text-sm font-medium text-mobile-text placeholder-mobile-muted focus:outline-none focus:ring-2 focus:ring-mobile-accent/30 focus:border-mobile-accent/40"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center"
            >
              <X size={12} className="text-mobile-muted" />
            </button>
          )}
        </div>

        {/* Stock filter chips + sort */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 flex-1 overflow-x-auto hide-scrollbar">
            {STOCK_FILTERS.map((f) => {
              const count =
                f.value === 'all' ? allProducts.length :
                f.value === 'out' ? outOfStockCount :
                f.value === 'low' ? lowStockCount :
                allProducts.length - outOfStockCount - lowStockCount;
              return (
                <button
                  key={f.value}
                  onClick={() => setStockFilter(f.value)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
                    stockFilter === f.value
                      ? 'bg-violet-600 text-white'
                      : f.color
                  }`}
                >
                  {f.label} {count > 0 && <span className="ml-0.5 opacity-70">{count}</span>}
                </button>
              );
            })}
          </div>

          {/* Sort button */}
          <div className="relative">
            <button
              onClick={() => setShowSort(!showSort)}
              className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center text-mobile-muted"
            >
              <ArrowUpDown size={16} />
            </button>
            {showSort && (
              <div className="absolute right-0 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-20 w-36 overflow-hidden">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setSort(opt.value); setShowSort(false); }}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                      sort === opt.value
                        ? 'bg-violet-50 text-violet-600 font-bold'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Product list (ALWAYS visible) */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 hide-scrollbar">
        {loading && !loaded && (
          <div className="text-center py-12">
            <div className="w-6 h-6 border-2 border-mobile-accent/30 border-t-mobile-accent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-mobile-muted">Chargement du catalogue...</p>
          </div>
        )}

        {loaded && displayProducts.length === 0 && (
          <div className="text-center py-12">
            <Package size={40} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-mobile-muted">
              {query ? `Aucun produit pour "${query}"` : 'Aucun produit en catalogue'}
            </p>
          </div>
        )}

        {/* Counter */}
        {loaded && displayProducts.length > 0 && (
          <p className="text-[10px] text-mobile-muted font-semibold px-1">
            {displayProducts.length} produit{displayProducts.length > 1 ? 's' : ''}
            {query && ` pour "${query}"`}
          </p>
        )}

        {displayProducts.map((product) => {
          const isOut = product.stockQuantity <= 0;
          const isLow =
            !isOut &&
            product.stockAlertThreshold != null &&
            product.stockQuantity <= product.stockAlertThreshold;

          return (
            <button
              key={product.id}
              onClick={() => setSelectedProduct(product)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-mobile-border/40 text-left active:scale-[0.98] transition-transform"
            >
              {/* Image */}
              <div className="w-12 h-12 rounded-xl bg-gray-50 flex-shrink-0 overflow-hidden">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Package size={18} className="text-gray-300" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-mobile-text truncate">{product.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {product.ean && (
                    <span className="text-[10px] text-mobile-muted font-mono">{product.ean}</span>
                  )}
                </div>
              </div>

              {/* Price + Stock */}
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-mobile-text">
                  {(product.priceMinorUnits / 100).toFixed(2)} €
                </p>
                <div className={`flex items-center gap-1 justify-end mt-0.5 ${
                  isOut ? 'text-red-600' : isLow ? 'text-amber-500' : 'text-emerald-500'
                }`}>
                  {(isOut || isLow) && <AlertTriangle size={10} />}
                  <span className="text-[10px] font-bold">
                    {isOut ? 'RUPTURE' : `${product.stockQuantity} en stock`}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Product detail card */}
      {selectedProduct && (
        <ProductCard
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onStockUpdated={(newQty) => {
            setSelectedProduct((p) => p ? { ...p, stockQuantity: newQty } : null);
            setAllProducts((prev) =>
              prev.map((p) =>
                p.id === selectedProduct.id ? { ...p, stockQuantity: newQty } : p,
              ),
            );
          }}
        />
      )}
    </div>
  );
}
