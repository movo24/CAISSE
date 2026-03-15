import React from 'react';
import { Layers } from 'lucide-react';

interface CategoryPanelProps {
  categories: string[];
  selected: string | null;
  onSelect: (cat: string | null) => void;
  orientation: 'vertical' | 'horizontal';
}

export function CategoryPanel({ categories, selected, onSelect, orientation }: CategoryPanelProps) {
  const isVertical = orientation === 'vertical';

  return (
    <div className={`${
      isVertical
        ? 'flex flex-col gap-1.5 p-2.5 overflow-y-auto cart-scroll'
        : 'flex gap-1.5 p-2 overflow-x-auto'
    } bg-white border-r border-pos-border/20`}>
      {/* Section label — landscape only */}
      {isVertical && (
        <p className="text-[10px] font-bold text-pos-muted uppercase tracking-widest px-1 pb-1">
          Categories
        </p>
      )}

      {/* "Tous" button */}
      <button
        onClick={() => onSelect(null)}
        className={`cat-btn-landscape flex items-center gap-2 font-semibold rounded-xl transition-all product-card-touch ${
          isVertical ? 'px-3 py-3.5 w-full text-sm' : 'px-4 py-2.5 flex-shrink-0 text-sm'
        } ${
          selected === null
            ? 'bg-pos-accent text-white shadow-lg shadow-pos-accent/25'
            : 'bg-pos-subtle text-pos-text hover:bg-gray-100'
        }`}
      >
        <Layers size={16} />
        <span>Tous</span>
        {selected === null && (
          <span className="ml-auto text-xs opacity-60">●</span>
        )}
      </button>

      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => onSelect(cat)}
          className={`cat-btn-landscape font-semibold rounded-xl transition-all product-card-touch ${
            isVertical ? 'px-3 py-3.5 w-full text-left text-sm' : 'px-4 py-2.5 flex-shrink-0 whitespace-nowrap text-sm'
          } ${
            selected === cat
              ? 'bg-pos-accent text-white shadow-lg shadow-pos-accent/25'
              : 'bg-pos-subtle text-pos-text hover:bg-gray-100'
          }`}
        >
          <span className="truncate">{cat}</span>
        </button>
      ))}
    </div>
  );
}
