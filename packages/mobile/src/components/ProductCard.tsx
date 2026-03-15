// ── ProductCard ──────────────────────────────────────────────────
// Bottom sheet showing product details after scan
// Photo, name, EAN, price, stock, +/- adjustment (if allowed)
//
// Stock adjust uses DELTA mode: sends +/- as relative change
// NaN protection on all displayed values
// ─────────────────────────────────────────────────────────────────

import { useState } from 'react';
import {
  X, Minus, Plus, Package, Tag, BarChart3,
  CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { stockApi } from '../services/api';

function safeInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

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

interface ProductCardProps {
  product: Product;
  onClose: () => void;
  onStockUpdated?: (newQuantity: number) => void;
}

export function ProductCard({ product, onClose, onStockUpdated }: ProductCardProps) {
  const canModifyStock = useAuthStore((s) => s.canModifyStock);
  const [adjustQty, setAdjustQty] = useState(0);
  const [adjusting, setAdjusting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stockQty = safeInt(product.stockQuantity);
  const price = safeInt(product.priceMinorUnits);
  const threshold = product.stockAlertThreshold != null ? safeInt(product.stockAlertThreshold) : null;
  const isLowStock = threshold !== null && stockQty <= threshold;

  const handleAdjust = async () => {
    if (adjustQty === 0) return;
    setAdjusting(true);
    setError(null);

    try {
      // Use DELTA mode — adjust relative to current stock
      await stockApi.adjust(product.id, {
        quantity: adjustQty,
        reason: adjustQty > 0 ? 'reception_mobile' : 'ajustement_mobile',
        mode: 'delta',
      });

      const newQty = Math.max(0, stockQty + adjustQty);
      setSuccess(true);
      onStockUpdated?.(newQty);
      setTimeout(() => {
        setSuccess(false);
        setAdjustQty(0);
      }, 1500);
    } catch (err: any) {
      const msg = err.response?.data?.message
        || (Array.isArray(err.response?.data?.message) ? err.response.data.message.join(', ') : null)
        || err.message
        || 'Erreur ajustement stock';
      setError(msg);
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-elevated sheet-slide-up safe-bottom">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-mobile-muted"
        >
          <X size={16} />
        </button>

        <div className="px-5 pb-6">
          {/* Product image + info */}
          <div className="flex gap-4 mb-5">
            <div className="w-20 h-20 rounded-2xl bg-gray-100 flex-shrink-0 overflow-hidden">
              {product.imageUrl ? (
                <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Package size={28} className="text-gray-300" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-mobile-text leading-tight">{product.name}</h2>
              {product.ean && <p className="text-xs text-mobile-muted font-mono mt-1">{product.ean}</p>}
              {product.categoryId && (
                <div className="flex items-center gap-1 mt-1.5">
                  <Tag size={11} className="text-mobile-muted" />
                  <span className="text-[11px] text-mobile-muted">{product.categoryId}</span>
                </div>
              )}
            </div>
          </div>

          {/* Price + Stock row */}
          <div className="flex gap-3 mb-5">
            <div className="flex-1 px-4 py-3 rounded-xl bg-gray-50">
              <p className="text-[10px] text-mobile-muted font-semibold uppercase tracking-wide">Prix</p>
              <p className="text-lg font-bold text-mobile-text mt-0.5">
                {(price / 100).toFixed(2)} <span className="text-sm">EUR</span>
              </p>
            </div>
            <div className={`flex-1 px-4 py-3 rounded-xl ${isLowStock ? 'bg-red-50' : 'bg-gray-50'}`}>
              <p className="text-[10px] text-mobile-muted font-semibold uppercase tracking-wide flex items-center gap-1">
                <BarChart3 size={10} />
                Stock
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className={`text-lg font-bold ${isLowStock ? 'text-red-600' : 'text-mobile-text'}`}>
                  {stockQty}
                </p>
                {isLowStock && <AlertTriangle size={14} className="text-red-500" />}
              </div>
            </div>
          </div>

          {/* Stock adjustment (manager/admin only) */}
          {canModifyStock() && (
            <div className="pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-mobile-text mb-3">Ajuster le stock</p>

              <div className="flex items-center justify-center gap-4 mb-4">
                <button
                  onClick={() => setAdjustQty((q) => q - 1)}
                  className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center active:scale-95 transition-transform"
                >
                  <Minus size={22} strokeWidth={2.5} />
                </button>

                <div className="w-20 text-center">
                  <span className={`text-3xl font-bold tabular-nums ${
                    adjustQty > 0 ? 'text-emerald-600' : adjustQty < 0 ? 'text-red-600' : 'text-mobile-text'
                  }`}>
                    {adjustQty > 0 ? `+${adjustQty}` : adjustQty}
                  </span>
                </div>

                <button
                  onClick={() => setAdjustQty((q) => q + 1)}
                  className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center active:scale-95 transition-transform"
                >
                  <Plus size={22} strokeWidth={2.5} />
                </button>
              </div>

              {/* New stock preview */}
              {adjustQty !== 0 && (
                <p className="text-xs text-mobile-muted text-center mb-3">
                  Nouveau stock: <strong className="text-mobile-text">{Math.max(0, stockQty + adjustQty)}</strong>
                </p>
              )}

              {error && <p className="text-xs text-red-500 text-center mb-3">{error}</p>}

              {success && (
                <div className="flex items-center justify-center gap-2 text-emerald-600 text-sm font-semibold mb-3">
                  <CheckCircle2 size={16} />
                  Stock mis a jour
                </div>
              )}

              <button
                onClick={handleAdjust}
                disabled={adjustQty === 0 || adjusting}
                className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all disabled:opacity-30 active:scale-[0.97] ${
                  adjustQty > 0 ? 'bg-emerald-500 text-white' : adjustQty < 0 ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-500'
                }`}
              >
                {adjusting
                  ? 'Enregistrement...'
                  : adjustQty === 0
                    ? 'Aucun ajustement'
                    : `Appliquer ${adjustQty > 0 ? '+' : ''}${adjustQty}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
