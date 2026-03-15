import React, { useMemo, useRef, useCallback } from 'react';
import { Plus, Weight, AlertTriangle } from 'lucide-react';
import type { CatalogueProduct } from '../../hooks/useCart';

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
      // Long press → could open quantity/discount dialog in future
      longPressTimerRef.current = null;
    }, 500);
  }, []);

  const handleTouchEnd = useCallback((product: CatalogueProduct) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      // Short tap → add to cart
      onAdd(product);
    }
  }, [onAdd]);

  // Landscape: 4 cols with bigger cards. Portrait: 3 cols.
  const gridCols = isLandscape ? 'grid-cols-4' : 'grid-cols-3';
  const gridGap = isLandscape ? 'gap-2.5' : 'gap-2';
  const gridPadding = isLandscape ? 'p-2.5' : 'p-3';

  if (filtered.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-pos-muted gap-3 p-8">
        <Plus size={48} strokeWidth={1} className="opacity-20" />
        <p className="text-base font-medium opacity-60">
          {searchTerm ? 'Aucun produit trouve' : category ? 'Aucun produit dans cette categorie' : 'Catalogue vide'}
        </p>
      </div>
    );
  }

  return (
    <div className={`grid ${gridCols} ${gridGap} ${gridPadding} overflow-y-auto cart-scroll content-start`}>
      {filtered.map((product) => {
        const isByWeight = product.unitType === 'kg';
        const isLowStock = product.stockQuantity <= (product.stockAlertThreshold || 5);

        return (
          <button
            key={product.id}
            className={`product-card-touch product-card-landscape flex flex-col items-start rounded-2xl bg-white border border-pos-border/20 shadow-soft transition-transform active:scale-[0.96] text-left relative overflow-hidden ${
              isLandscape ? 'p-3.5' : 'p-3'
            }`}
            style={isLandscape ? { minHeight: '100px' } : undefined}
            onTouchStart={() => handleTouchStart(product)}
            onTouchEnd={() => handleTouchEnd(product)}
            onClick={() => onAdd(product)}
          >
            {/* Low stock badge */}
            {isLowStock && (
              <div className="absolute top-2 right-2">
                <AlertTriangle size={13} className="text-amber-500" />
              </div>
            )}

            {/* Weight badge */}
            {isByWeight && (
              <div className="absolute top-2 left-2">
                <span className={`flex items-center gap-0.5 font-bold text-amber-600 bg-amber-50 rounded-full ring-1 ring-amber-200 ${
                  isLandscape ? 'text-[10px] px-2 py-0.5' : 'text-[9px] px-1.5 py-0.5'
                }`}>
                  <Weight size={isLandscape ? 9 : 8} /> KG
                </span>
              </div>
            )}

            {/* Product name — bigger in landscape */}
            <p className={`product-name font-semibold text-pos-text line-clamp-2 leading-tight ${
              isLandscape ? 'text-[15px] mt-1 min-h-[2.5rem]' : 'text-sm mt-1 min-h-[2.5rem]'
            }`}>
              {product.name}
            </p>

            {/* Price — bigger in landscape */}
            <div className="mt-auto pt-2 w-full">
              {isByWeight ? (
                <p className={`product-price font-bold text-amber-600 ${isLandscape ? 'text-lg' : 'text-base'}`}>
                  {formatPrice(product.priceMinorUnits)}/kg
                </p>
              ) : (
                <p className={`product-price font-bold text-pos-text ${isLandscape ? 'text-lg' : 'text-base'}`}>
                  {formatPrice(product.priceMinorUnits)}
                </p>
              )}
            </div>

            {/* Quick add touch indicator — visible on touch */}
            <div className={`absolute bottom-2 right-2 rounded-full bg-pos-accent/8 flex items-center justify-center ${
              isLandscape ? 'w-8 h-8' : 'w-7 h-7'
            }`}>
              <Plus size={isLandscape ? 16 : 14} className="text-pos-accent/40" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
