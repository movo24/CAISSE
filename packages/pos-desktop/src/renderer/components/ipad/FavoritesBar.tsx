import React from 'react';
import { Star } from 'lucide-react';

interface FavoriteItem {
  productId: string;
  name: string;
  priceMinorUnits: number;
  isPinned: boolean;
}

interface FavoritesBarProps {
  favorites: FavoriteItem[];
  onSelect: (productId: string) => void;
  onToggleFavorite: (productId: string) => void;
}

function formatPrice(minorUnits: number) {
  return (minorUnits / 100).toFixed(2).replace('.', ',') + ' \u20ac';
}

export function FavoritesBar({ favorites, onSelect, onToggleFavorite }: FavoritesBarProps) {
  if (favorites.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto bg-gradient-to-r from-amber-50/30 to-orange-50/30 border-b border-pos-border/10">
      <Star size={12} className="text-amber-500 flex-shrink-0" />
      {favorites.map((fav) => (
        <button
          key={fav.productId}
          onClick={() => onSelect(fav.productId)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-pos-border/20 shadow-soft text-xs font-medium text-pos-text hover:bg-amber-50 transition-colors flex-shrink-0 product-card-touch"
        >
          <span className="truncate max-w-[100px]">{fav.name}</span>
          <span className="text-pos-muted text-[10px]">{formatPrice(fav.priceMinorUnits)}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(fav.productId); }}
            className="w-4 h-4 flex items-center justify-center"
          >
            <Star size={10} className={fav.isPinned ? 'text-amber-500 fill-amber-500' : 'text-gray-300'} />
          </button>
        </button>
      ))}
    </div>
  );
}
