// ── ReceivingPage ────────────────────────────────────────────────
// Continuous scan for receiving deliveries
// Scan products → record received quantities → submit stock adjustments
// ─────────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, PackageCheck, Minus, Plus, Trash2,
  Send, CheckCircle2,
} from 'lucide-react';
import { ScannerOverlay } from '../components/ScannerOverlay';
import { useScannerStore } from '../stores/scannerStore';
import { productsApi, stockApi } from '../services/api';
import { ScanResult } from '../hooks/useScanner';

export function ReceivingPage() {
  const navigate = useNavigate();
  const { sessionType, startSession, addScan, adjustCount, removeItem, endSession, getItems, totalItems, totalScans } = useScannerStore();

  const [showScanner, setShowScanner] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionType !== 'receiving') {
      startSession('receiving');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScan = useCallback(async (result: ScanResult) => {
    try {
      const res = await productsApi.scan(result.code);
      const product = res.data;
      addScan({
        id: product.id,
        name: product.name,
        ean: product.ean || result.code,
        categoryId: product.categoryId,
        priceMinorUnits: product.priceMinorUnits,
        imageUrl: product.imageUrl,
        stockQuantity: product.stockQuantity,
      });
    } catch {
      // Product not found — ignore
    }
  }, [addScan]);

  const handleSubmitReceiving = async () => {
    const items = getItems();
    if (items.length === 0) return;

    setSubmitting(true);
    setError(null);

    try {
      for (const item of items) {
        if (item.counted > 0) {
          await stockApi.adjust(item.product.id, {
            quantity: item.counted,
            reason: 'reception_mobile',
          });
        }
      }
      setSubmitted(true);
      endSession();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur lors de la reception');
    } finally {
      setSubmitting(false);
    }
  };

  const items = getItems();
  const totalReceived = items.reduce((sum, i) => sum + i.counted, 0);

  // Scanner view
  if (showScanner) {
    return (
      <ScannerOverlay
        title="Reception"
        onScan={handleScan}
        continuous
        bottomContent={
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
        }
      />
    );
  }

  // Success view
  if (submitted) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6">
        <CheckCircle2 size={64} className="text-emerald-500 mb-4" />
        <h2 className="text-xl font-bold text-mobile-text mb-2">Reception validee</h2>
        <p className="text-sm text-mobile-muted text-center mb-6">
          Le stock a ete mis a jour avec les quantites recues.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-3 rounded-2xl bg-mobile-accent text-white font-bold text-sm"
        >
          Retour a l'accueil
        </button>
      </div>
    );
  }

  // List view
  return (
    <div className="min-h-[100dvh] flex flex-col bg-mobile-bg safe-top">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 bg-white border-b border-mobile-border/40">
        <button onClick={() => navigate('/')} className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
          <ArrowLeft size={18} className="text-mobile-text" />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-mobile-text">Reception</h1>
          <p className="text-xs text-mobile-muted">
            {totalItems()} produit{totalItems() > 1 ? 's' : ''} | {totalReceived} unite{totalReceived > 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowScanner(true)}
          className="px-4 py-2.5 rounded-xl bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
        >
          <PackageCheck size={14} />
          Scanner
        </button>
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 hide-scrollbar">
        {items.length === 0 ? (
          <div className="text-center py-12">
            <PackageCheck size={40} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-mobile-muted">Aucun produit recu</p>
            <button
              onClick={() => setShowScanner(true)}
              className="mt-4 px-6 py-3 rounded-2xl bg-emerald-500 text-white font-bold text-sm"
            >
              Commencer le scan
            </button>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.product.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-mobile-border/40"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-mobile-text truncate">
                  {item.product.name}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-mobile-muted">
                    Stock actuel: <strong>{item.theoretical}</strong>
                  </span>
                  <span className="text-[10px] font-bold text-emerald-600">
                    Recu: +{item.counted}
                  </span>
                </div>
              </div>

              {/* +/- controls */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => adjustCount(item.product.id, -1)}
                  className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-mobile-muted active:bg-red-50 active:text-red-500"
                >
                  <Minus size={14} />
                </button>
                <span className="w-8 text-center text-sm font-bold text-emerald-600">
                  {item.counted}
                </span>
                <button
                  onClick={() => adjustCount(item.product.id, 1)}
                  className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-mobile-muted active:bg-emerald-50 active:text-emerald-500"
                >
                  <Plus size={14} />
                </button>
              </div>

              {/* Remove */}
              <button
                onClick={() => removeItem(item.product.id)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 active:text-red-500"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 px-4 py-2 rounded-xl bg-red-50 border border-red-100 text-red-600 text-xs font-medium text-center">
          {error}
        </div>
      )}

      {/* Submit button */}
      {items.length > 0 && (
        <div className="px-4 py-3 bg-white border-t border-mobile-border/40 safe-bottom">
          <button
            onClick={handleSubmitReceiving}
            disabled={submitting || totalReceived === 0}
            className="w-full py-3.5 rounded-2xl bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity"
          >
            {submitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Send size={16} />
                Valider la reception ({totalReceived} unite{totalReceived > 1 ? 's' : ''})
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
