// ── ScanPage ─────────────────────────────────────────────────────
// Scan → identify product → action
//
// Flow:
// 1. Scan barcode
// 2. Search backend by EAN
// 3a. Product found → show ProductCard (view info + adjust stock)
// 3b. Product NOT found (404) → offer to create it
// ─────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';
import { ScannerOverlay } from '../components/ScannerOverlay';
import { ProductCard } from '../components/ProductCard';
import { CreateProductForm } from '../components/CreateProductForm';
import { productsApi } from '../services/api';
import { ScanResult } from '../hooks/useScanner';
import { useAuthStore } from '../stores/authStore';

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
  const canModifyStock = useAuthStore((s) => s.canModifyStock);
  const [product, setProduct] = useState<Product | null>(null);
  const [unknownEan, setUnknownEan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleScan = useCallback(async (result: ScanResult) => {
    setError(null);
    setUnknownEan(null);
    setLoading(true);

    console.log('[Scan] Code:', result.code, 'format:', result.format);

    try {
      const res = await productsApi.scan(result.code);
      const data = res.data;

      setProduct({
        ...data,
        priceMinorUnits: safeInt(data.priceMinorUnits),
        stockQuantity: safeInt(data.stockQuantity),
        stockAlertThreshold: data.stockAlertThreshold != null ? safeInt(data.stockAlertThreshold) : undefined,
      });
    } catch (err: any) {
      if (err.response?.status === 404) {
        // Product not in database — offer creation
        setUnknownEan(result.code);
        setProduct(null);
      } else {
        setError('Erreur de connexion au serveur');
        setProduct(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleProductCreated = (newProduct: any) => {
    setUnknownEan(null);
    setProduct({
      ...newProduct,
      priceMinorUnits: safeInt(newProduct.priceMinorUnits),
      stockQuantity: safeInt(newProduct.stockQuantity),
      stockAlertThreshold: newProduct.stockAlertThreshold != null
        ? safeInt(newProduct.stockAlertThreshold) : undefined,
    });
  };

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
            {/* Product not found notification (inline in scanner) */}
            {unknownEan && (
              <div className="px-4 py-3 rounded-xl bg-amber-500/20 backdrop-blur border border-amber-400/30">
                <p className="text-white text-xs font-bold text-center mb-1">
                  Produit inconnu : {unknownEan}
                </p>
                {canModifyStock() ? (
                  <p className="text-white/70 text-[10px] text-center">
                    Formulaire de création ouvert ci-dessous
                  </p>
                ) : (
                  <p className="text-white/70 text-[10px] text-center">
                    Contactez un manager pour ajouter ce produit
                  </p>
                )}
              </div>
            )}
          </>
        }
      />

      {/* Product found → show details + stock actions */}
      {product && (
        <ProductCard
          product={product}
          onClose={() => setProduct(null)}
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
          onClose={() => setUnknownEan(null)}
        />
      )}
    </>
  );
}
