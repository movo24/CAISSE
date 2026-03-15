// ── InventoryPage ────────────────────────────────────────────────
// Continuous scan for inventory counting
//
// Flow: scan → product found → added to list → count +1
// Display: product name, EAN, theoretical vs counted, écart
// Validation: sends ABSOLUTE quantity to backend (not delta)
//
// NaN protection: all numbers go through safeInt()
// ─────────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, CheckCircle2,
  Minus, Plus, Trash2, Send, ScanBarcode,
} from 'lucide-react';
import { ScannerOverlay } from '../components/ScannerOverlay';
import { useScannerStore, SessionItem } from '../stores/scannerStore';
import { useAuthStore } from '../stores/authStore';
import { productsApi, stockApi } from '../services/api';
import { ScanResult } from '../hooks/useScanner';

/** Safely convert to integer, NaN → 0 */
function safeInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function InventoryPage() {
  const navigate = useNavigate();
  const canModifyStock = useAuthStore((s) => s.canModifyStock);
  const {
    sessionType, startSession, addScan, adjustCount, removeItem,
    endSession, getItems, totalItems, totalScans, mismatches,
  } = useScannerStore();

  const [showScanner, setShowScanner] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitProgress, setSubmitProgress] = useState({ current: 0, total: 0 });
  const [lastAddedName, setLastAddedName] = useState<string | null>(null);

  // Start inventory session on mount (if not already active)
  useEffect(() => {
    if (sessionType !== 'inventory') {
      startSession('inventory');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScan = useCallback(async (result: ScanResult) => {
    console.log('[Inventaire] Scan brut:', result.code, 'format:', result.format);

    try {
      const res = await productsApi.scan(result.code);
      const product = res.data;

      console.log('[Inventaire] Produit:', product.name, 'stock:', product.stockQuantity);

      addScan({
        id: product.id,
        name: product.name || 'Produit sans nom',
        ean: product.ean || result.code,
        categoryId: product.categoryId,
        priceMinorUnits: safeInt(product.priceMinorUnits),
        imageUrl: product.imageUrl,
        stockQuantity: safeInt(product.stockQuantity),
      });

      setLastAddedName(product.name);
      setTimeout(() => setLastAddedName(null), 2000);
    } catch (err: any) {
      console.warn('[Inventaire] Produit non trouvé:', result.code, err?.response?.status);
    }
  }, [addScan]);

  const handleSubmitInventory = async () => {
    const items = getItems();

    if (items.length === 0) {
      setError('Aucun produit à valider');
      return;
    }

    // Only submit items where counted differs from theoretical
    const diffs = items.filter((i) => safeInt(i.counted) !== safeInt(i.theoretical));

    if (diffs.length === 0) {
      setSubmitted(true);
      endSession();
      return;
    }

    setSubmitting(true);
    setError(null);
    setSubmitProgress({ current: 0, total: diffs.length });

    const errors: string[] = [];

    for (let idx = 0; idx < diffs.length; idx++) {
      const item = diffs[idx];
      const newAbsoluteQuantity = safeInt(item.counted);

      console.log(
        `[Inventaire] Ajust ${idx + 1}/${diffs.length}:`,
        item.product.name,
        `théo=${safeInt(item.theoretical)} → compté=${newAbsoluteQuantity}`,
      );

      setSubmitProgress({ current: idx + 1, total: diffs.length });

      try {
        await stockApi.adjust(item.product.id, {
          quantity: newAbsoluteQuantity,
          reason: 'inventaire_mobile',
          mode: 'absolute',
        });
      } catch (err: any) {
        const msg = err.response?.data?.message
          || (Array.isArray(err.response?.data?.message) ? err.response.data.message.join(', ') : null)
          || err.message
          || 'Erreur inconnue';
        console.error(`[Inventaire] Erreur ${item.product.name}:`, msg, err.response?.data);
        errors.push(`${item.product.name}: ${msg}`);
      }
    }

    setSubmitting(false);

    if (errors.length > 0) {
      setError(`${errors.length} erreur(s) :\n${errors.join('\n')}`);
    } else {
      setSubmitted(true);
      endSession();
    }
  };

  const items = getItems();
  const mismatchList = mismatches();

  // ── Scanner fullscreen ──
  if (showScanner) {
    return (
      <ScannerOverlay
        title="Inventaire"
        onScan={handleScan}
        continuous
        bottomContent={
          <div className="space-y-2">
            {lastAddedName && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/90 backdrop-blur text-white text-sm font-bold animate-slide-up">
                <CheckCircle2 size={16} />
                <span className="truncate">{lastAddedName}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-white/80 text-xs font-medium">
                {totalItems()} produit{totalItems() > 1 ? 's' : ''} | {totalScans()} scan{totalScans() > 1 ? 's' : ''}
              </span>
              <button
                onClick={() => setShowScanner(false)}
                className="px-4 py-2 rounded-xl bg-white/20 backdrop-blur text-white text-xs font-bold"
              >
                Voir la liste
              </button>
            </div>
          </div>
        }
      />
    );
  }

  // ── Success ──
  if (submitted) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 bg-mobile-bg">
        <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-5 animate-scale-in">
          <CheckCircle2 size={40} className="text-emerald-500" />
        </div>
        <h2 className="text-xl font-bold text-mobile-text mb-2">Inventaire valide</h2>
        <p className="text-sm text-mobile-muted text-center mb-6">
          Les ecarts ont ete enregistres avec succes.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-8 py-3.5 rounded-2xl bg-mobile-accent text-white font-bold text-sm active:scale-95 transition-transform"
        >
          Retour a l'accueil
        </button>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="min-h-[100dvh] flex flex-col bg-mobile-bg safe-top">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 bg-white border-b border-mobile-border/40">
        <button onClick={() => navigate('/')} className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center active:scale-95 transition-transform">
          <ArrowLeft size={18} className="text-mobile-text" />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-mobile-text">Inventaire</h1>
          <p className="text-xs text-mobile-muted">
            {totalItems()} produit{totalItems() > 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowScanner(true)}
          className="px-4 py-2.5 rounded-xl bg-mobile-accent text-white text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-transform"
        >
          <ScanBarcode size={14} />
          Scanner
        </button>
      </div>

      {/* Summary counters */}
      {items.length > 0 && (
        <div className="mx-4 mt-3 flex gap-2">
          <div className="flex-1 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-100 text-center">
            <p className="text-[10px] text-emerald-600 font-semibold uppercase">Conformes</p>
            <p className="text-lg font-bold text-emerald-700">{items.length - mismatchList.length}</p>
          </div>
          <div className="flex-1 px-3 py-2 rounded-xl bg-amber-50 border border-amber-100 text-center">
            <p className="text-[10px] text-amber-600 font-semibold uppercase">Ecarts</p>
            <p className="text-lg font-bold text-amber-700">{mismatchList.length}</p>
          </div>
          <div className="flex-1 px-3 py-2 rounded-xl bg-violet-50 border border-violet-100 text-center">
            <p className="text-[10px] text-violet-600 font-semibold uppercase">Total</p>
            <p className="text-lg font-bold text-violet-700">{items.length}</p>
          </div>
        </div>
      )}

      {/* Items list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 hide-scrollbar">
        {items.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <ClipboardList size={28} className="text-gray-300" />
            </div>
            <p className="text-sm font-semibold text-mobile-text mb-1">Aucun produit scanne</p>
            <p className="text-xs text-mobile-muted mb-5">Scannez les produits pour commencer</p>
            <button
              onClick={() => setShowScanner(true)}
              className="px-6 py-3 rounded-2xl bg-mobile-accent text-white font-bold text-sm active:scale-95 transition-transform"
            >
              Commencer le scan
            </button>
          </div>
        ) : (
          items.map((item) => (
            <InventoryItemRow
              key={item.product.id}
              item={item}
              onAdjust={adjustCount}
              onRemove={removeItem}
            />
          ))
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
          <p className="text-red-700 text-xs font-semibold mb-1">Erreur de validation</p>
          <p className="text-red-600 text-[11px] whitespace-pre-line">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 text-xs font-bold mt-2 underline">
            Fermer
          </button>
        </div>
      )}

      {/* Submit */}
      {items.length > 0 && (
        <div className="px-4 py-3 bg-white border-t border-mobile-border/40 safe-bottom">
          {submitting && submitProgress.total > 0 && (
            <div className="mb-3">
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-mobile-accent rounded-full transition-all duration-300"
                  style={{ width: `${(submitProgress.current / submitProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-mobile-muted text-center mt-1">
                Envoi {submitProgress.current}/{submitProgress.total}...
              </p>
            </div>
          )}

          <button
            onClick={handleSubmitInventory}
            disabled={submitting || !canModifyStock()}
            className="w-full py-3.5 rounded-2xl bg-mobile-accent text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 transition-all active:scale-[0.97]"
          >
            {submitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Send size={16} />
                {mismatchList.length > 0
                  ? `Valider (${mismatchList.length} ecart${mismatchList.length > 1 ? 's' : ''})`
                  : 'Valider — aucun ecart'}
              </>
            )}
          </button>
          {!canModifyStock() && (
            <p className="text-[10px] text-mobile-muted text-center mt-2">
              Seul un manager ou admin peut valider
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inventory item row component ──

function InventoryItemRow({
  item,
  onAdjust,
  onRemove,
}: {
  item: SessionItem;
  onAdjust: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
}) {
  const theoretical = safeInt(item.theoretical);
  const counted = safeInt(item.counted);
  const ecart = counted - theoretical;
  const hasEcart = ecart !== 0;

  return (
    <div className={`rounded-xl bg-white border overflow-hidden ${
      hasEcart ? 'border-amber-200 shadow-sm' : 'border-mobile-border/40'
    }`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-mobile-text truncate">{item.product.name}</p>
          <p className="text-[10px] text-mobile-muted font-mono mt-0.5">{item.product.ean}</p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onAdjust(item.product.id, -1)}
            className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-mobile-muted active:bg-red-50 active:text-red-500 transition-colors"
          >
            <Minus size={14} />
          </button>
          <span className="w-10 text-center text-base font-bold text-mobile-text tabular-nums">
            {counted}
          </span>
          <button
            onClick={() => onAdjust(item.product.id, 1)}
            className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-mobile-muted active:bg-emerald-50 active:text-emerald-500 transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>

        <button
          onClick={() => onRemove(item.product.id)}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 active:text-red-500 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Status bar */}
      <div className={`flex items-center gap-3 px-4 py-1.5 text-[10px] font-semibold ${
        hasEcart ? 'bg-amber-50' : 'bg-emerald-50'
      }`}>
        <span className="text-mobile-muted">
          Theorique: <strong className="text-mobile-text">{theoretical}</strong>
        </span>
        <span className="text-mobile-muted">
          Compte: <strong className="text-mobile-text">{counted}</strong>
        </span>
        <span className="ml-auto">
          {hasEcart ? (
            <span className={ecart > 0 ? 'text-emerald-600' : 'text-red-600'}>
              Ecart: {ecart > 0 ? '+' : ''}{ecart}
            </span>
          ) : (
            <span className="text-emerald-600 flex items-center gap-1">
              <CheckCircle2 size={10} />
              Conforme
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
