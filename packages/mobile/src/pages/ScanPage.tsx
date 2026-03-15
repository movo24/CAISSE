// ── ScanPage ─────────────────────────────────────────────────────
// Simple scan → display product info
// Available to all authenticated roles
// ─────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';
import { ScannerOverlay } from '../components/ScannerOverlay';
import { ProductCard } from '../components/ProductCard';
import { productsApi } from '../services/api';
import { ScanResult } from '../hooks/useScanner';

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

export function ScanPage() {
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleScan = useCallback(async (result: ScanResult) => {
    setError(null);
    setLoading(true);

    console.log('[Scan] Code:', result.code, 'format:', result.format);

    try {
      const res = await productsApi.scan(result.code);
      const data = res.data;

      // Sanitize all numeric fields
      setProduct({
        ...data,
        priceMinorUnits: safeInt(data.priceMinorUnits),
        stockQuantity: safeInt(data.stockQuantity),
        stockAlertThreshold: data.stockAlertThreshold != null ? safeInt(data.stockAlertThreshold) : undefined,
      });
    } catch (err: any) {
      if (err.response?.status === 404) {
        setError(`Produit introuvable : ${result.code}`);
      } else {
        setError('Erreur de connexion au serveur');
      }
      setProduct(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <>
      <ScannerOverlay
        title="Scanner"
        onScan={handleScan}
        bottomContent={
          <>
            {loading && (
              <div className="text-center py-2">
                <div className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}
            {error && (
              <div className="px-4 py-2.5 rounded-xl bg-red-500/20 backdrop-blur border border-red-400/30 text-white text-xs text-center font-medium">
                {error}
              </div>
            )}
          </>
        }
      />

      {product && (
        <ProductCard
          product={product}
          onClose={() => setProduct(null)}
          onStockUpdated={(newQty) => {
            setProduct((p) => p ? { ...p, stockQuantity: newQty } : null);
          }}
        />
      )}
    </>
  );
}
