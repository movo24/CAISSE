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
  CheckCircle2, AlertTriangle, ChevronDown, ShieldAlert,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { stockApi, productsApi } from '../services/api';
import { ProductImagePicker } from './ProductImagePicker';

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

const STOCK_REASONS = [
  { value: 'reception', label: 'Réception marchandise', type: 'positive' },
  { value: 'retour_client', label: 'Retour client', type: 'positive' },
  { value: 'correction_inventaire', label: 'Correction inventaire', type: 'both' },
  { value: 'casse', label: 'Casse', type: 'negative' },
  { value: 'vol_client', label: 'Vol client', type: 'negative' },
  { value: 'perte_inconnue', label: 'Perte inconnue', type: 'negative' },
  { value: 'retour_fournisseur', label: 'Retour fournisseur', type: 'negative' },
  { value: 'erreur_caisse', label: 'Erreur caisse', type: 'negative' },
  { value: 'autre', label: 'Autre', type: 'both' },
] as const;

const MANAGER_THRESHOLD = -5; // Needs manager confirmation if adjustment <= -5

export function ProductCard({ product, onClose, onStockUpdated }: ProductCardProps) {
  const canModifyStock = useAuthStore((s) => s.canModifyStock);
  const [adjustQty, setAdjustQty] = useState(0);
  const [adjusting, setAdjusting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState(product.imageUrl || null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonComment, setReasonComment] = useState('');
  const [showReasonPicker, setShowReasonPicker] = useState(false);

  const stockQty = safeInt(product.stockQuantity);
  const price = safeInt(product.priceMinorUnits);
  const threshold = product.stockAlertThreshold != null ? safeInt(product.stockAlertThreshold) : null;
  const isLowStock = threshold !== null && stockQty <= threshold;

  const handleAdjustClick = () => {
    if (adjustQty === 0) return;
    setError(null);
    // Show reason picker before adjustment
    setShowReasonPicker(true);
  };

  const handleConfirmAdjust = async () => {
    if (!reason) {
      setError('Sélectionnez un motif');
      return;
    }
    if (reason === 'autre' && !reasonComment.trim()) {
      setError('Commentaire obligatoire pour "Autre"');
      return;
    }

    setShowReasonPicker(false);
    setAdjusting(true);
    setError(null);

    const reasonLabel = STOCK_REASONS.find((r) => r.value === reason)?.label || reason;
    const fullReason = reason === 'autre'
      ? `Autre: ${reasonComment.trim()}`
      : reasonLabel;

    try {
      await stockApi.adjust(product.id, {
        quantity: adjustQty,
        reason: fullReason,
        mode: 'delta',
      });

      const newQty = Math.max(0, stockQty + adjustQty);
      setSuccess(true);
      onStockUpdated?.(newQty);
      setTimeout(() => {
        setSuccess(false);
        setAdjustQty(0);
        setReason('');
        setReasonComment('');
      }, 1500);
    } catch (err: any) {
      const rawMsg = err.response?.data?.message;
      const msg = Array.isArray(rawMsg)
        ? rawMsg.join(', ')
        : (rawMsg || err.message || 'Erreur ajustement stock');
      setError(msg);
    } finally {
      setAdjusting(false);
    }
  };

  const handleImageUpload = async (dataUrl: string) => {
    setUploadingImage(true);
    try {
      await productsApi.update(product.id, { imageUrl: dataUrl });
      setImageUrl(dataUrl);
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Erreur upload image';
      setError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleImageRemove = async () => {
    setUploadingImage(true);
    try {
      await productsApi.update(product.id, { imageUrl: null });
      setImageUrl(null);
    } catch {
      setError('Erreur suppression image');
    } finally {
      setUploadingImage(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-elevated sheet-slide-up safe-bottom max-h-[90vh] overflow-y-auto">
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
          {/* Product info header */}
          <div className="flex gap-4 mb-4">
            <div className="w-20 h-20 rounded-2xl bg-gray-100 flex-shrink-0 overflow-hidden">
              {imageUrl ? (
                <img src={imageUrl} alt={product.name} className="w-full h-full object-cover" />
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

          {/* Photo section */}
          <div className="mb-5 pt-4 border-t border-gray-100">
            <ProductImagePicker
              currentImage={imageUrl}
              onImageSelected={handleImageUpload}
              onImageRemoved={handleImageRemove}
              uploading={uploadingImage}
            />
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

              {/* Threshold warning */}
              {adjustQty <= MANAGER_THRESHOLD && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 mb-3">
                  <ShieldAlert size={14} className="text-amber-600 flex-shrink-0" />
                  <p className="text-[10px] text-amber-700 font-medium">
                    Ajustement important ({adjustQty}) — vérification manager recommandée
                  </p>
                </div>
              )}

              {error && <p className="text-xs text-red-500 text-center mb-3">{error}</p>}

              {success && (
                <div className="flex items-center justify-center gap-2 text-emerald-600 text-sm font-semibold mb-3">
                  <CheckCircle2 size={16} />
                  Stock mis à jour
                </div>
              )}

              {/* Reason picker (shows before confirm) */}
              {showReasonPicker && (
                <div className="mb-4 p-4 rounded-2xl border border-gray-200 bg-gray-50 space-y-3">
                  <p className="text-xs font-bold text-gray-700">Motif de l'ajustement <span className="text-red-500">*</span></p>
                  <div className="grid grid-cols-2 gap-2">
                    {STOCK_REASONS
                      .filter((r) => r.type === 'both' || (adjustQty > 0 ? r.type === 'positive' : r.type === 'negative'))
                      .map((r) => (
                        <button
                          key={r.value}
                          type="button"
                          onClick={() => { setReason(r.value); setError(null); }}
                          className={`px-3 py-2.5 rounded-xl text-[11px] font-semibold border transition-all ${
                            reason === r.value
                              ? 'bg-violet-600 text-white border-violet-600'
                              : 'bg-white text-gray-600 border-gray-200 active:scale-95'
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                  </div>

                  {reason === 'autre' && (
                    <input
                      type="text"
                      value={reasonComment}
                      onChange={(e) => setReasonComment(e.target.value)}
                      placeholder="Précisez le motif..."
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
                      autoFocus
                    />
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowReasonPicker(false); setReason(''); setReasonComment(''); }}
                      className="flex-1 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-500"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={handleConfirmAdjust}
                      disabled={!reason || adjusting}
                      className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-bold disabled:opacity-40"
                    >
                      {adjusting ? 'Enregistrement...' : 'Confirmer'}
                    </button>
                  </div>
                </div>
              )}

              {/* Adjust button (opens reason picker) */}
              {!showReasonPicker && (
                <button
                  onClick={handleAdjustClick}
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
