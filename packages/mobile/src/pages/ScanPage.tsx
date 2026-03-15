// ── ScanPage ─────────────────────────────────────────────────────
// Scan → identify product → action
//
// Flow:
// 1. Scan barcode
// 2. Search backend by EAN
// 3a. Product found → show ProductCard (view info + adjust stock)
// 3b. Product NOT found (404) → offer to create it
//
// Status bar shows real-time pipeline state at bottom of scanner.
// ─────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';
import { ScannerOverlay } from '../components/ScannerOverlay';
import { ProductCard } from '../components/ProductCard';
import { CreateProductForm } from '../components/CreateProductForm';
import { productsApi } from '../services/api';
import { ScanResult } from '../hooks/useScanner';
import { useAuthStore } from '../stores/authStore';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, PackagePlus } from 'lucide-react';

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

type PipelineStatus =
  | { step: 'idle' }
  | { step: 'scanning' }
  | { step: 'searching'; code: string }
  | { step: 'found'; product: Product }
  | { step: 'not-found'; code: string }
  | { step: 'error'; message: string; code: string };

export function ScanPage() {
  const canModifyStock = useAuthStore((s) => s.canModifyStock);
  const [product, setProduct] = useState<Product | null>(null);
  const [unknownEan, setUnknownEan] = useState<string | null>(null);
  const [status, setStatus] = useState<PipelineStatus>({ step: 'idle' });

  const handleScan = useCallback(async (result: ScanResult) => {
    const code = result.code;
    console.log('[ScanPage] 1. Code scanné:', code, 'format:', result.format);
    setStatus({ step: 'searching', code });
    setProduct(null);
    setUnknownEan(null);

    try {
      console.log('[ScanPage] 2. Recherche produit... GET /products/scan/' + code);
      const res = await productsApi.scan(code);
      const data = res.data;
      console.log('[ScanPage] 3. Produit TROUVE:', data.name, 'stock:', data.stockQuantity);

      const p: Product = {
        ...data,
        priceMinorUnits: safeInt(data.priceMinorUnits),
        stockQuantity: safeInt(data.stockQuantity),
        stockAlertThreshold: data.stockAlertThreshold != null ? safeInt(data.stockAlertThreshold) : undefined,
      };

      setProduct(p);
      setStatus({ step: 'found', product: p });
    } catch (err: any) {
      if (err.response?.status === 404) {
        console.log('[ScanPage] 3. Produit NON TROUVE (404) pour code:', code);
        setUnknownEan(code);
        setStatus({ step: 'not-found', code });
      } else {
        const msg = err.response?.data?.message || err.message || 'Erreur inconnue';
        console.error('[ScanPage] 3. ERREUR:', err.response?.status, msg);
        setStatus({ step: 'error', message: msg, code });
      }
    }
  }, []);

  const handleProductCreated = (newProduct: any) => {
    console.log('[ScanPage] Produit créé:', newProduct.name);
    setUnknownEan(null);
    const p: Product = {
      ...newProduct,
      priceMinorUnits: safeInt(newProduct.priceMinorUnits),
      stockQuantity: safeInt(newProduct.stockQuantity),
      stockAlertThreshold: newProduct.stockAlertThreshold != null
        ? safeInt(newProduct.stockAlertThreshold) : undefined,
    };
    setProduct(p);
    setStatus({ step: 'found', product: p });
  };

  return (
    <>
      <ScannerOverlay
        title="Scanner"
        onScan={handleScan}
        bottomContent={
          <StatusBar
            status={status}
            canCreate={canModifyStock()}
            onCreateClick={() => {
              if (status.step === 'not-found') {
                setUnknownEan(status.code);
              }
            }}
          />
        }
      />

      {/* Product found → show details + stock actions */}
      {product && (
        <ProductCard
          product={product}
          onClose={() => {
            setProduct(null);
            setStatus({ step: 'idle' });
          }}
          onStockUpdated={(newQty) => {
            setProduct((p) => p ? { ...p, stockQuantity: newQty } : null);
          }}
        />
      )}

      {/* Product NOT found → creation form (managers/admins only) */}
      {unknownEan && canModifyStock() && (
        <CreateProductForm
          ean={unknownEan}
          onCreated={handleProductCreated}
          onClose={() => {
            setUnknownEan(null);
            setStatus({ step: 'idle' });
          }}
        />
      )}
    </>
  );
}

// ── Status Bar — shows pipeline state visually ──

function StatusBar({
  status,
  canCreate,
  onCreateClick,
}: {
  status: PipelineStatus;
  canCreate: boolean;
  onCreateClick: () => void;
}) {
  if (status.step === 'idle') return null;

  return (
    <div className="space-y-2">
      {/* Searching */}
      {status.step === 'searching' && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-blue-500/20 backdrop-blur border border-blue-400/30">
          <Loader2 size={16} className="text-blue-300 animate-spin" />
          <div className="flex-1">
            <p className="text-white text-xs font-bold">Recherche en cours...</p>
            <p className="text-white/60 text-[10px] font-mono">{status.code}</p>
          </div>
        </div>
      )}

      {/* Found */}
      {status.step === 'found' && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/20 backdrop-blur border border-emerald-400/30">
          <CheckCircle2 size={16} className="text-emerald-400" />
          <div className="flex-1">
            <p className="text-white text-xs font-bold">{status.product.name}</p>
            <p className="text-white/60 text-[10px]">
              Stock: {status.product.stockQuantity} · {((status.product.priceMinorUnits) / 100).toFixed(2)}€
            </p>
          </div>
          <span className="text-emerald-300 text-[10px] font-bold">TROUVÉ</span>
        </div>
      )}

      {/* Not found */}
      {status.step === 'not-found' && (
        <div className="px-4 py-3 rounded-xl bg-amber-500/20 backdrop-blur border border-amber-400/30">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-400" />
            <div className="flex-1">
              <p className="text-white text-xs font-bold">Produit inconnu</p>
              <p className="text-white/60 text-[10px] font-mono">{status.code}</p>
            </div>
          </div>
          {canCreate && (
            <button
              onClick={onCreateClick}
              className="w-full mt-2 py-2.5 rounded-xl bg-violet-600/80 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
            >
              <PackagePlus size={14} />
              Créer ce produit
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {status.step === 'error' && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/20 backdrop-blur border border-red-400/30">
          <XCircle size={16} className="text-red-400" />
          <div className="flex-1">
            <p className="text-white text-xs font-bold">Erreur serveur</p>
            <p className="text-white/60 text-[10px]">{status.message}</p>
          </div>
        </div>
      )}
    </div>
  );
}
