// ── ProductCard ──────────────────────────────────────────────────
// Bottom sheet: product info + 2 stock modes
// Mode A: Inventaire — type real count, system calculates gap
// Mode B: Ajustement — quick +/- delta with buttons or keyboard
// Both require mandatory reason before saving
// ─────────────────────────────────────────────────────────────────

import { useState, useRef } from 'react';
import {
  X, Minus, Plus, Package, Tag, BarChart3,
  CheckCircle2, AlertTriangle, ShieldAlert, ClipboardList, Pencil,
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

const REASONS_NEGATIVE = [
  { value: 'casse', label: 'Casse' },
  { value: 'vol_client', label: 'Vol client' },
  { value: 'perte_inconnue', label: 'Perte inconnue' },
  { value: 'retour_fournisseur', label: 'Retour fournisseur' },
  { value: 'erreur_caisse', label: 'Erreur caisse' },
  { value: 'produit_perime', label: 'Produit périmé' },
  { value: 'correction_inventaire', label: 'Correction inventaire' },
  { value: 'autre', label: 'Autre' },
];

const REASONS_POSITIVE = [
  { value: 'reception', label: 'Réception marchandise' },
  { value: 'retour_client', label: 'Retour client' },
  { value: 'correction_inventaire', label: 'Correction inventaire' },
  { value: 'autre', label: 'Autre' },
];

type StockMode = 'none' | 'inventory' | 'adjust';

export function ProductCard({ product, onClose, onStockUpdated }: ProductCardProps) {
  const canModifyStock = useAuthStore((s) => s.canModifyStock);

  // Image state
  const [imageUrl, setImageUrl] = useState(product.imageUrl || null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Stock mode
  const [mode, setMode] = useState<StockMode>('none');

  // Inventory mode: type real stock count
  const [realCount, setRealCount] = useState('');
  const realCountRef = useRef<HTMLInputElement>(null);

  // Adjust mode: +/- delta or type directly
  const [adjustQty, setAdjustQty] = useState(0);
  const [adjustInput, setAdjustInput] = useState('');
  const [useKeyboard, setUseKeyboard] = useState(false);

  // Reason
  const [reason, setReason] = useState('');
  const [reasonComment, setReasonComment] = useState('');
  const [showReason, setShowReason] = useState(false);

  // Status
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stockQty = safeInt(product.stockQuantity);
  const price = safeInt(product.priceMinorUnits);
  const threshold = product.stockAlertThreshold != null ? safeInt(product.stockAlertThreshold) : null;
  const isLowStock = threshold !== null && stockQty <= threshold;

  // Computed values based on mode
  const computedNewStock = mode === 'inventory'
    ? (realCount !== '' ? Math.max(0, parseInt(realCount, 10) || 0) : null)
    : Math.max(0, stockQty + adjustQty);
  const computedDelta = mode === 'inventory'
    ? (computedNewStock !== null ? computedNewStock - stockQty : 0)
    : adjustQty;
  const hasDelta = computedDelta !== 0;
  const isNegative = computedDelta < 0;

  // Get the right reason list based on direction
  const reasonList = isNegative ? REASONS_NEGATIVE : REASONS_POSITIVE;

  const handleStartMode = (m: StockMode) => {
    setMode(m);
    setRealCount('');
    setAdjustQty(0);
    setAdjustInput('');
    setUseKeyboard(false);
    setReason('');
    setReasonComment('');
    setShowReason(false);
    setError(null);
    if (m === 'inventory') {
      setTimeout(() => realCountRef.current?.focus(), 200);
    }
  };

  const handleValidateClick = () => {
    if (!hasDelta) {
      setError('Aucune modification');
      return;
    }
    setError(null);
    setShowReason(true);
  };

  const handleConfirm = async () => {
    if (!reason) {
      setError('Motif obligatoire');
      return;
    }
    if (reason === 'autre' && !reasonComment.trim()) {
      setError('Commentaire obligatoire pour "Autre"');
      return;
    }

    setSaving(true);
    setError(null);

    const label = reasonList.find((r) => r.value === reason)?.label || reason;
    const fullReason = reason === 'autre' ? `Autre: ${reasonComment.trim()}` : label;
    const modeLabel = mode === 'inventory' ? 'Inventaire' : 'Ajustement';

    try {
      if (mode === 'inventory') {
        // Absolute mode: set stock to realCount
        await stockApi.adjust(product.id, {
          quantity: parseInt(realCount, 10) || 0,
          reason: `[${modeLabel}] ${fullReason} (ancien: ${stockQty}, nouveau: ${computedNewStock}, écart: ${computedDelta > 0 ? '+' : ''}${computedDelta})`,
          mode: 'absolute',
        });
      } else {
        // Delta mode: add/subtract
        await stockApi.adjust(product.id, {
          quantity: adjustQty,
          reason: `[${modeLabel}] ${fullReason}`,
          mode: 'delta',
        });
      }

      const newQty = computedNewStock ?? Math.max(0, stockQty + adjustQty);
      setSuccess(true);
      onStockUpdated?.(newQty);
      setTimeout(() => {
        setSuccess(false);
        setMode('none');
        setReason('');
        setReasonComment('');
        setShowReason(false);
      }, 1500);
    } catch (err: any) {
      const rawMsg = err.response?.data?.message;
      setError(Array.isArray(rawMsg) ? rawMsg.join(', ') : (rawMsg || 'Erreur'));
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (dataUrl: string) => {
    setUploadingImage(true);
    try {
      await productsApi.update(product.id, { imageUrl: dataUrl });
      setImageUrl(dataUrl);
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Erreur upload';
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-elevated sheet-slide-up safe-bottom max-h-[90vh] overflow-y-auto">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-mobile-muted">
          <X size={16} />
        </button>

        <div className="px-5 pb-6">
          {/* Product header */}
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

          {/* Photo */}
          <div className="mb-5 pt-4 border-t border-gray-100">
            <ProductImagePicker currentImage={imageUrl} onImageSelected={handleImageUpload} onImageRemoved={handleImageRemove} uploading={uploadingImage} />
          </div>

          {/* Price + Stock */}
          <div className="flex gap-3 mb-5">
            <div className="flex-1 px-4 py-3 rounded-xl bg-gray-50">
              <p className="text-[10px] text-mobile-muted font-semibold uppercase tracking-wide">Prix</p>
              <p className="text-lg font-bold text-mobile-text mt-0.5">{(price / 100).toFixed(2)} €</p>
            </div>
            <div className={`flex-1 px-4 py-3 rounded-xl ${isLowStock ? 'bg-red-50' : 'bg-gray-50'}`}>
              <p className="text-[10px] text-mobile-muted font-semibold uppercase tracking-wide flex items-center gap-1">
                <BarChart3 size={10} /> Stock système
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className={`text-lg font-bold ${isLowStock ? 'text-red-600' : 'text-mobile-text'}`}>{stockQty}</p>
                {isLowStock && <AlertTriangle size={14} className="text-red-500" />}
              </div>
            </div>
          </div>

          {/* Stock actions (manager/admin only) */}
          {canModifyStock() && mode === 'none' && !success && (
            <div className="pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-mobile-text mb-3">Modifier le stock</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleStartMode('inventory')}
                  className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-gray-200 hover:border-violet-400 active:scale-95 transition-all"
                >
                  <ClipboardList size={24} className="text-violet-600" />
                  <span className="text-xs font-bold text-gray-700">Inventaire</span>
                  <span className="text-[10px] text-gray-400">Stock réel constaté</span>
                </button>
                <button
                  onClick={() => handleStartMode('adjust')}
                  className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-gray-200 hover:border-emerald-400 active:scale-95 transition-all"
                >
                  <Pencil size={24} className="text-emerald-600" />
                  <span className="text-xs font-bold text-gray-700">Ajustement</span>
                  <span className="text-[10px] text-gray-400">+ / - rapide</span>
                </button>
              </div>
            </div>
          )}

          {/* ─── MODE INVENTAIRE ─── */}
          {mode === 'inventory' && !showReason && !success && (
            <div className="pt-4 border-t border-gray-100">
              <p className="text-xs font-bold text-gray-700 mb-3">📋 Inventaire — Stock réel constaté</p>

              <div className="bg-gray-50 rounded-2xl p-4 mb-4">
                <label className="block text-[10px] text-gray-500 font-semibold uppercase mb-2">
                  Quantité comptée
                </label>
                <input
                  ref={realCountRef}
                  type="text"
                  inputMode="numeric"
                  value={realCount}
                  onChange={(e) => setRealCount(e.target.value.replace(/\D/g, ''))}
                  placeholder="Tapez la quantité réelle..."
                  className="w-full text-center text-3xl font-bold py-4 rounded-xl border-2 border-gray-200 focus:border-violet-500 focus:outline-none bg-white"
                  autoFocus
                />
              </div>

              {/* Gap preview */}
              {realCount !== '' && (
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="text-center p-2 rounded-xl bg-gray-100">
                    <p className="text-[9px] text-gray-500 font-semibold">SYSTÈME</p>
                    <p className="text-lg font-bold text-gray-600">{stockQty}</p>
                  </div>
                  <div className="text-center p-2 rounded-xl bg-violet-50">
                    <p className="text-[9px] text-violet-500 font-semibold">COMPTÉ</p>
                    <p className="text-lg font-bold text-violet-600">{computedNewStock}</p>
                  </div>
                  <div className={`text-center p-2 rounded-xl ${computedDelta === 0 ? 'bg-gray-100' : isNegative ? 'bg-red-50' : 'bg-emerald-50'}`}>
                    <p className="text-[9px] text-gray-500 font-semibold">ÉCART</p>
                    <p className={`text-lg font-bold ${computedDelta === 0 ? 'text-gray-400' : isNegative ? 'text-red-600' : 'text-emerald-600'}`}>
                      {computedDelta > 0 ? '+' : ''}{computedDelta}
                    </p>
                  </div>
                </div>
              )}

              {/* Warning big gap */}
              {computedDelta <= -5 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 mb-3">
                  <ShieldAlert size={14} className="text-amber-600 flex-shrink-0" />
                  <p className="text-[10px] text-amber-700 font-medium">Écart important ({computedDelta}) — vérification recommandée</p>
                </div>
              )}

              {error && <p className="text-xs text-red-500 text-center mb-3">{error}</p>}

              <div className="flex gap-2">
                <button onClick={() => setMode('none')} className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-500">Annuler</button>
                <button
                  onClick={handleValidateClick}
                  disabled={realCount === '' || !hasDelta}
                  className="flex-1 py-3 rounded-2xl bg-violet-600 text-white text-sm font-bold disabled:opacity-30"
                >
                  Valider l'inventaire
                </button>
              </div>
            </div>
          )}

          {/* ─── MODE AJUSTEMENT ─── */}
          {mode === 'adjust' && !showReason && !success && (
            <div className="pt-4 border-t border-gray-100">
              <p className="text-xs font-bold text-gray-700 mb-3">✏️ Ajustement rapide</p>

              {!useKeyboard ? (
                /* Buttons +/- */
                <div className="flex items-center justify-center gap-4 mb-4">
                  <button onClick={() => setAdjustQty((q) => q - 1)} className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center active:scale-95 transition-transform">
                    <Minus size={22} strokeWidth={2.5} />
                  </button>
                  <button onClick={() => setUseKeyboard(true)} className="w-24 text-center cursor-text">
                    <span className={`text-3xl font-bold tabular-nums ${adjustQty > 0 ? 'text-emerald-600' : adjustQty < 0 ? 'text-red-600' : 'text-mobile-text'}`}>
                      {adjustQty > 0 ? `+${adjustQty}` : adjustQty}
                    </span>
                    <p className="text-[9px] text-gray-400 mt-1">Tap pour saisir</p>
                  </button>
                  <button onClick={() => setAdjustQty((q) => q + 1)} className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center active:scale-95 transition-transform">
                    <Plus size={22} strokeWidth={2.5} />
                  </button>
                </div>
              ) : (
                /* Keyboard input */
                <div className="mb-4">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={adjustInput}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9-]/g, '');
                      setAdjustInput(val);
                      const n = parseInt(val, 10);
                      setAdjustQty(isNaN(n) ? 0 : n);
                    }}
                    placeholder="Ex: -3 ou +10"
                    className="w-full text-center text-2xl font-bold py-3 rounded-xl border-2 border-gray-200 focus:border-violet-500 focus:outline-none"
                    autoFocus
                  />
                  <button onClick={() => { setUseKeyboard(false); setAdjustInput(''); }} className="w-full mt-2 text-xs text-violet-600 font-semibold">
                    ← Boutons +/-
                  </button>
                </div>
              )}

              {/* Preview */}
              {adjustQty !== 0 && (
                <p className="text-xs text-mobile-muted text-center mb-3">
                  {stockQty} → <strong className="text-mobile-text">{Math.max(0, stockQty + adjustQty)}</strong>
                </p>
              )}

              {adjustQty <= -5 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 mb-3">
                  <ShieldAlert size={14} className="text-amber-600 flex-shrink-0" />
                  <p className="text-[10px] text-amber-700 font-medium">Ajustement important ({adjustQty})</p>
                </div>
              )}

              {error && <p className="text-xs text-red-500 text-center mb-3">{error}</p>}

              <div className="flex gap-2">
                <button onClick={() => setMode('none')} className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-500">Annuler</button>
                <button
                  onClick={handleValidateClick}
                  disabled={adjustQty === 0}
                  className={`flex-1 py-3 rounded-2xl text-white text-sm font-bold disabled:opacity-30 ${adjustQty > 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                >
                  Appliquer {adjustQty > 0 ? '+' : ''}{adjustQty}
                </button>
              </div>
            </div>
          )}

          {/* ─── REASON PICKER (both modes) ─── */}
          {showReason && !success && (
            <div className="pt-4 border-t border-gray-100">
              <div className="p-4 rounded-2xl border border-gray-200 bg-gray-50 space-y-3">
                <p className="text-xs font-bold text-gray-700">
                  Motif {isNegative ? 'de la baisse' : "de l'augmentation"} <span className="text-red-500">*</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {reasonList.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => { setReason(r.value); setError(null); }}
                      className={`px-3 py-2.5 rounded-xl text-[11px] font-semibold border transition-all ${
                        reason === r.value ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200 active:scale-95'
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

                {error && <p className="text-xs text-red-500 text-center">{error}</p>}

                <div className="flex gap-2">
                  <button onClick={() => { setShowReason(false); setReason(''); setReasonComment(''); }} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-500">Retour</button>
                  <button onClick={handleConfirm} disabled={!reason || saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-bold disabled:opacity-40">
                    {saving ? 'Enregistrement...' : 'Confirmer'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── SUCCESS ─── */}
          {success && (
            <div className="pt-4 border-t border-gray-100">
              <div className="flex flex-col items-center gap-2 py-6 rounded-2xl bg-emerald-50 border border-emerald-200">
                <CheckCircle2 size={32} className="text-emerald-500" />
                <p className="text-sm font-bold text-emerald-700">Stock mis à jour !</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
