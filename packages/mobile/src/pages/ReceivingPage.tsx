// ── ReceivingPage ────────────────────────────────────────────────
// Continuous scan for receiving deliveries
// Scan → record received quantities → submit stock adjustments
//
// Validation: sends quantity as DELTA (mode='delta') — adds to current stock
// NaN protection: all numbers go through safeInt()
// ─────────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, PackageCheck, Minus, Plus, Trash2,
  Send, CheckCircle2, ScanBarcode,
} from 'lucide-react';
import { ScannerOverlay } from '../components/ScannerOverlay';
import { useScannerStore } from '../stores/scannerStore';
import { productsApi, stockApi } from '../services/api';
import { ScanResult } from '../hooks/useScanner';

function safeInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function ReceivingPage() {
  const navigate = useNavigate();
  const {
    sessionType, startSession, addScan, adjustCount, removeItem,
    endSession, getItems, totalItems, totalScans,
  } = useScannerStore();

  const [showScanner, setShowScanner] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitProgress, setSubmitProgress] = useState({ current: 0, total: 0 });
  const [lastAddedName, setLastAddedName] = useState<string | null>(null);

  useEffect(() => {
    if (sessionType !== 'receiving') {
      startSession('receiving');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScan = useCallback(async (result: ScanResult) => {
    console.log('[Reception] Scan brut:', result.code);

    try {
      const res = await productsApi.scan(result.code);
      const product = res.data;

      console.log('[Reception] Produit:', product.name, 'stock actuel:', product.stockQuantity);

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
    } catch {
      // Product not found — ignore
    }
  }, [addScan]);

  const handleSubmitReceiving = async () => {
    const items = getItems();
    if (items.length === 0) return;

    // Filter items with counted > 0
    const toSubmit = items.filter((i) => safeInt(i.counted) > 0);
    if (toSubmit.length === 0) {
      setError('Aucune quantité reçue à enregistrer');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSubmitProgress({ current: 0, total: toSubmit.length });

    const errors: string[] = [];

    for (let idx = 0; idx < toSubmit.length; idx++) {
      const item = toSubmit[idx];
      const receivedQty = safeInt(item.counted);

      console.log(
        `[Reception] Ajust ${idx + 1}/${toSubmit.length}:`,
        item.product.name,
        `+${receivedQty} (stock actuel: ${safeInt(item.theoretical)})`,
      );

      setSubmitProgress({ current: idx + 1, total: toSubmit.length });

      try {
        // Use DELTA mode — add received quantity to current stock
        await stockApi.adjust(item.product.id, {
          quantity: receivedQty,
          reason: 'reception_mobile',
          mode: 'delta',
        });
      } catch (err: any) {
        const msg = err.response?.data?.message
          || (Array.isArray(err.response?.data?.message) ? err.response.data.message.join(', ') : null)
          || err.message
          || 'Erreur inconnue';
        console.error(`[Reception] Erreur ${item.product.name}:`, msg);
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
  const totalReceived = items.reduce((sum, i) => sum + safeInt(i.counted), 0);

  // ── Scanner ──
  if (showScanner) {
    return (
      <ScannerOverlay
        title="Reception"
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
                {totalItems()} produit{totalItems() > 1 ? 's' : ''} | {totalReceived} unite{totalReceived > 1 ? 's' : ''}
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
        <h2 className="text-xl font-bold text-mobile-text mb-2">Reception validee</h2>
        <p className="text-sm text-mobile-muted text-center mb-6">
          Le stock a ete mis a jour avec les quantites recues.
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
          <h1 className="text-base font-bold text-mobile-text">Reception</h1>
          <p className="text-xs text-mobile-muted">
            {totalItems()} produit{totalItems() > 1 ? 's' : ''} | +{totalReceived} unite{totalReceived > 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowScanner(true)}
          className="px-4 py-2.5 rounded-xl bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-transform"
        >
          <ScanBarcode size={14} />
          Scanner
        </button>
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 hide-scrollbar">
        {items.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <PackageCheck size={28} className="text-gray-300" />
            </div>
            <p className="text-sm font-semibold text-mobile-text mb-1">Aucun produit recu</p>
            <p className="text-xs text-mobile-muted mb-5">Scannez les produits a leur arrivee</p>
            <button
              onClick={() => setShowScanner(true)}
              className="px-6 py-3 rounded-2xl bg-emerald-500 text-white font-bold text-sm active:scale-95 transition-transform"
            >
              Commencer le scan
            </button>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.product.id}
              className="rounded-xl bg-white border border-mobile-border/40 overflow-hidden"
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-mobile-text truncate">{item.product.name}</p>
                  <p className="text-[10px] text-mobile-muted font-mono mt-0.5">{item.product.ean}</p>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => adjustCount(item.product.id, -1)}
                    className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-mobile-muted active:bg-red-50 active:text-red-500 transition-colors"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-10 text-center text-base font-bold text-emerald-600 tabular-nums">
                    +{safeInt(item.counted)}
                  </span>
                  <button
                    onClick={() => adjustCount(item.product.id, 1)}
                    className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-mobile-muted active:bg-emerald-50 active:text-emerald-500 transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <button
                  onClick={() => removeItem(item.product.id)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 active:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="flex items-center gap-3 px-4 py-1.5 bg-emerald-50 text-[10px] font-semibold">
                <span className="text-mobile-muted">
                  Stock actuel: <strong className="text-mobile-text">{safeInt(item.theoretical)}</strong>
                </span>
                <span className="text-emerald-600 ml-auto">
                  Apres reception: {safeInt(item.theoretical) + safeInt(item.counted)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
          <p className="text-red-700 text-xs font-semibold mb-1">Erreur</p>
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
                  className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                  style={{ width: `${(submitProgress.current / submitProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-mobile-muted text-center mt-1">
                Envoi {submitProgress.current}/{submitProgress.total}...
              </p>
            </div>
          )}

          <button
            onClick={handleSubmitReceiving}
            disabled={submitting || totalReceived === 0}
            className="w-full py-3.5 rounded-2xl bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 transition-all active:scale-[0.97]"
          >
            {submitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Send size={16} />
                Valider (+{totalReceived} unite{totalReceived > 1 ? 's' : ''})
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
