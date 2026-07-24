import React, { useMemo, useRef, useCallback } from 'react';
import { Plus, Weight, AlertTriangle, ShoppingBag } from 'lucide-react';
import type { CatalogueProduct } from '../../hooks/useCart';
import { productDisplayName } from '../../utils/productDisplay';

interface ProductGridProps {
  products: CatalogueProduct[];
  category: string | null;
  searchTerm: string;
  onAdd: (product: CatalogueProduct) => void;
  isLandscape: boolean;
}

function formatPrice(minorUnits: number) {
  return (minorUnits / 100).toFixed(2).replace('.', ',') + ' \u20ac';
}

// ── Colorful category-based colors (Shortcuts/LaunchCuts style) ──
const CARD_COLORS = [
  { bg: 'bg-rose-500', text: 'text-white', accent: 'bg-rose-400/30' },
  { bg: 'bg-blue-500', text: 'text-white', accent: 'bg-blue-400/30' },
  { bg: 'bg-emerald-500', text: 'text-white', accent: 'bg-emerald-400/30' },
  { bg: 'bg-violet-500', text: 'text-white', accent: 'bg-violet-400/30' },
  { bg: 'bg-amber-500', text: 'text-white', accent: 'bg-amber-400/30' },
  { bg: 'bg-cyan-500', text: 'text-white', accent: 'bg-cyan-400/30' },
  { bg: 'bg-pink-500', text: 'text-white', accent: 'bg-pink-400/30' },
  { bg: 'bg-orange-500', text: 'text-white', accent: 'bg-orange-400/30' },
  { bg: 'bg-indigo-500', text: 'text-white', accent: 'bg-indigo-400/30' },
  { bg: 'bg-teal-500', text: 'text-white', accent: 'bg-teal-400/30' },
  { bg: 'bg-red-500', text: 'text-white', accent: 'bg-red-400/30' },
  { bg: 'bg-lime-600', text: 'text-white', accent: 'bg-lime-400/30' },
];

function getColorForProduct(name: string, categoryId?: string | null): typeof CARD_COLORS[0] {
  // Hash based on category (same category = same color family)
  const key = categoryId || name;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return CARD_COLORS[Math.abs(hash) % CARD_COLORS.length];
}

export function ProductGrid({ products, category, searchTerm, onAdd, isLandscape }: ProductGridProps) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = useMemo(() => {
    let list = products.filter((p) => p.isActive);
    if (category) {
      list = list.filter((p) => p.categoryId === category);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        p.ean.includes(q),
      );
    }
    return list;
  }, [products, category, searchTerm]);

  const handleTouchStart = useCallback((product: CatalogueProduct) => {
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
    }, 500);
  }, []);

  const handleTouchEnd = useCallback((product: CatalogueProduct) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      onAdd(product);
    }
  }, [onAdd]);

  const gridCols = isLandscape ? 'grid-cols-4' : 'grid-cols-3';

  if (filtered.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-pos-muted gap-3 p-8">
        <ShoppingBag size={48} strokeWidth={1} className="opacity-20" />
        <p className="text-base font-medium opacity-60">
          {searchTerm ? 'Aucun produit trouve' : category ? 'Aucun produit dans cette categorie' : 'Catalogue vide'}
        </p>
      </div>
    );
  }

  return (
    <div className={`grid ${gridCols} gap-3 p-3 overflow-y-auto cart-scroll content-start`}>
      {filtered.map((product) => {
        const isByWeight = product.unitType === 'kg';
        // Chantier 4 : un stock ≤ 0 n'empêche JAMAIS l'ajout au panier ni le
        // paiement — badge informatif seulement (dette de stock si négatif).
        const isNegativeStock = product.stockQuantity < 0;
        const isLowStock = product.stockQuantity <= (product.stockAlertThreshold || 5);
        const color = getColorForProduct(productDisplayName(product), product.categoryId);

        return (
          <button
            key={product.id}
            className={`${color.bg} relative flex flex-col rounded-2xl shadow-lg transition-all active:scale-[0.94] active:shadow-md text-left overflow-hidden ${
              isLandscape ? 'p-4 min-h-[110px]' : 'p-3 min-h-[100px]'
            }`}
            onTouchStart={() => handleTouchStart(product)}
            onTouchEnd={() => handleTouchEnd(product)}
            onClick={() => onAdd(product)}
          >
            {/* Decorative accent circle */}
            <div className={`absolute -top-4 -right-4 w-16 h-16 rounded-full ${color.accent}`} />
            <div className={`absolute -bottom-6 -left-6 w-20 h-20 rounded-full ${color.accent} opacity-50`} />

            {/* Low / negative stock badge — informatif, jamais bloquant */}
            {isNegativeStock ? (
              <div className="absolute top-2 right-2 flex items-center gap-1 bg-purple-700/80 rounded-full px-1.5 py-0.5">
                <AlertTriangle size={10} className="text-white" />
                <span className="text-[9px] font-bold text-white">{product.stockQuantity}</span>
              </div>
            ) : isLowStock ? (
              <div className="absolute top-2 right-2 bg-black/20 rounded-full p-1">
                <AlertTriangle size={12} className="text-yellow-300" />
              </div>
            ) : null}

            {/* Weight badge */}
            {isByWeight && (
              <div className="absolute top-2 left-2">
                <span className="flex items-center gap-0.5 text-[9px] font-bold text-white bg-black/20 rounded-full px-1.5 py-0.5">
                  <Weight size={8} /> KG
                </span>
              </div>
            )}

            {/* Product name */}
            <p className={`${color.text} font-bold line-clamp-2 leading-tight relative z-10 ${
              isLandscape ? 'text-[15px]' : 'text-sm'
            }`}>
              {productDisplayName(product)}
            </p>

            {/* Price — bottom */}
            <div className="mt-auto pt-2 relative z-10">
              <p className={`font-black ${color.text} opacity-90 ${isLandscape ? 'text-xl' : 'text-lg'}`}>
                {formatPrice(product.priceMinorUnits)}
                {isByWeight ? '/kg' : ''}
              </p>
            </div>

            {/* Quick add indicator */}
            <div className={`absolute bottom-2 right-2 rounded-full bg-white/20 flex items-center justify-center ${
              isLandscape ? 'w-8 h-8' : 'w-7 h-7'
            }`}>
              <Plus size={isLandscape ? 16 : 14} className="text-white/70" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
