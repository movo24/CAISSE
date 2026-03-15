// ── SearchPage ───────────────────────────────────────────────────
// Text search with debounce, shows products with stock info
// Available to all authenticated roles
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, Package, BarChart3, AlertTriangle, Tag, X,
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

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Focus search input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 200);
  }, []);

  // Debounced search (300ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const q = query.toLowerCase().trim();
      const filtered = allProducts.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.ean?.toLowerCase().includes(q) ||
          p.categoryId?.toLowerCase().includes(q),
      );
      setResults(filtered);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, allProducts]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-mobile-bg safe-top">
      {/* Search header */}
      <div className="px-4 pt-4 pb-3 bg-white border-b border-mobile-border/40">
        <div className="relative">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mobile-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom, EAN, categorie..."
            className="w-full pl-11 pr-10 py-3 rounded-2xl bg-gray-50 border border-mobile-border/40 text-sm font-medium text-mobile-text placeholder-mobile-muted focus:outline-none focus:ring-2 focus:ring-mobile-accent/30 focus:border-mobile-accent/40"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center"
            >
              <X size={12} className="text-mobile-muted" />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 hide-scrollbar">
        {loading && !loaded && (
          <div className="text-center py-12">
            <div className="w-6 h-6 border-2 border-mobile-accent/30 border-t-mobile-accent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-mobile-muted">Chargement du catalogue...</p>
          </div>
        )}

        {loaded && !query && (
          <div className="text-center py-12">
            <Search size={40} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-mobile-muted">
              Recherchez par nom, code EAN ou categorie
            </p>
            <p className="text-xs text-mobile-muted mt-1">
              {allProducts.length} produit{allProducts.length > 1 ? 's' : ''} en catalogue
            </p>
          </div>
        )}

        {loaded && query && results.length === 0 && (
          <div className="text-center py-12">
            <Package size={40} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-mobile-muted">
              Aucun produit trouve pour "{query}"
            </p>
          </div>
        )}

        {results.map((product) => {
          const isLowStock =
            product.stockAlertThreshold !== undefined &&
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
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Package size={18} className="text-gray-300" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-mobile-text truncate">
                  {product.name}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {product.ean && (
                    <span className="text-[10px] text-mobile-muted font-mono">{product.ean}</span>
                  )}
                  {product.categoryId && (
                    <span className="flex items-center gap-0.5 text-[10px] text-mobile-muted">
                      <Tag size={8} />
                      {product.categoryId}
                    </span>
                  )}
                </div>
              </div>

              {/* Price + Stock */}
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-mobile-text">
                  {(product.priceMinorUnits / 100).toFixed(2)} EUR
                </p>
                <div className={`flex items-center gap-1 justify-end mt-0.5 ${
                  isLowStock ? 'text-red-500' : 'text-mobile-muted'
                }`}>
                  {isLowStock && <AlertTriangle size={10} />}
                  <span className="text-[10px] font-semibold">
                    {product.stockQuantity} en stock
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
