import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { usePOSStore } from '../stores/posStore';
import { productsApi, customersApi } from '../services/api';

/* ── Product type (mirrors backend API) ── */

export interface CatalogueProduct {
  id: string;
  ean: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  unitType: string;
  priceMinorUnits: number;
  currencyCode: string;
  costMinorUnits?: number;
  taxRate: string | number;
  imageUrl?: string | null;
  stockQuantity: number;
  stockAlertThreshold?: number;
  stockCriticalThreshold?: number;
  isActive: boolean;
  storeId: string;
}

export function useCart() {
  const store = usePOSStore();
  const scanRef = useRef<HTMLInputElement>(null);

  const [catalogue, setCatalogue] = useState<CatalogueProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [scanValue, setScanValue] = useState('');
  const [error, setError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);

  // Weight modal
  const [weightModal, setWeightModal] = useState<CatalogueProduct | null>(null);
  const [weightValue, setWeightValue] = useState('');

  // Load catalogue on mount
  useEffect(() => {
    productsApi.list()
      .then((res) => {
        if (Array.isArray(res.data)) setCatalogue(res.data);
      })
      .catch(() => {
        console.warn('[CATALOGUE] Backend unavailable — empty catalogue');
      });

    productsApi.categories()
      .then((res) => {
        if (Array.isArray(res.data)) {
          // API may return strings or {id, name} objects — normalize to strings
          setCategories(res.data.map((c: any) => typeof c === 'string' ? c : c.name || c.id || String(c)));
        }
      })
      .catch(() => {
        // Categories endpoint may not exist yet
      });
  }, []);

  // Smart search
  const searchResults = useMemo(() => {
    if (!scanValue.trim() || store.scanMode === 'customer') return [];
    const q = scanValue.toLowerCase().trim();
    return catalogue
      .filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        p.ean.includes(q),
      )
      .slice(0, 8);
  }, [scanValue, store.scanMode, catalogue]);

  const addProductToCart = useCallback((product: CatalogueProduct, weightKg?: number) => {
    const isByWeight = product.unitType === 'kg';
    if (isByWeight && weightKg) {
      if (weightKg <= 0) return;
      const priceMinor = Math.round(product.priceMinorUnits * weightKg);
      store.addToCart({
        productId: product.id + '-' + Date.now(),
        ean: product.ean,
        name: `${product.name} (${weightKg.toFixed(3)} kg)`,
        unitPriceMinorUnits: priceMinor,
      });
    } else {
      store.addToCart({
        productId: product.id,
        ean: product.ean,
        name: product.name,
        unitPriceMinorUnits: product.priceMinorUnits,
      });
    }
    setScanValue('');
    setSearchOpen(false);
    setSelectedIdx(-1);
    scanRef.current?.focus();
  }, [store]);

  const handleSelectProduct = useCallback((product: CatalogueProduct) => {
    if (product.unitType === 'kg') {
      setWeightModal(product);
      setWeightValue('');
    } else {
      addProductToCart(product);
    }
  }, [addProductToCart]);

  const handleWeightConfirm = useCallback(() => {
    if (!weightModal) return;
    const kg = parseFloat(weightValue.replace(',', '.'));
    if (isNaN(kg) || kg <= 0) return;
    addProductToCart(weightModal, kg);
    setWeightModal(null);
    setWeightValue('');
  }, [weightModal, weightValue, addProductToCart]);

  // Anti-double scan: ignore same barcode within 1.5 seconds
  const lastScanRef = useRef<{ value: string; time: number }>({ value: '', time: 0 });

  const handleScan = useCallback(async (value: string) => {
    if (!value.trim()) return;
    const now = Date.now();
    if (lastScanRef.current.value === value.trim() && now - lastScanRef.current.time < 1500) {
      return; // Same barcode within 1.5s → ignore
    }
    lastScanRef.current = { value: value.trim(), time: now };
    setError('');
    const localMatch = catalogue.find((p) => p.ean === value.trim());
    if (localMatch) { handleSelectProduct(localMatch); return; }
    if (searchResults.length > 0) {
      const idx = selectedIdx >= 0 ? selectedIdx : 0;
      handleSelectProduct(searchResults[idx]);
      return;
    }
    try {
      if (store.scanMode === 'customer') {
        const res = await customersApi.findByQr(value);
        if (res.data) { store.setCustomer(res.data, value); store.setScanMode('product'); }
      } else {
        const res = await productsApi.scan(value);
        if (res.data) {
          store.addToCart({ productId: res.data.id, ean: res.data.ean, name: res.data.name, unitPriceMinorUnits: res.data.priceMinorUnits });
        } else { setError(`Produit non trouve : ${value}`); }
      }
    } catch {
      const fuzzy = catalogue.find((p) => p.name.toLowerCase().includes(value.toLowerCase()));
      if (fuzzy) { handleSelectProduct(fuzzy); } else { setError(`Produit non trouve : ${value}`); }
    }
    setScanValue('');
    setSearchOpen(false);
    scanRef.current?.focus();
  }, [catalogue, searchResults, selectedIdx, store, handleSelectProduct]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (searchResults.length === 0) { if (e.key === 'Enter') handleScan(scanValue); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, searchResults.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); handleSelectProduct(searchResults[selectedIdx >= 0 ? selectedIdx : 0]); }
    else if (e.key === 'Escape') { setSearchOpen(false); }
  }, [searchResults, scanValue, selectedIdx, handleScan, handleSelectProduct]);

  return {
    // State
    catalogue,
    categories,
    scanValue,
    setScanValue,
    error,
    setError,
    searchOpen,
    setSearchOpen,
    selectedIdx,
    setSelectedIdx,
    searchResults,
    scanRef,

    // Weight modal
    weightModal,
    setWeightModal,
    weightValue,
    setWeightValue,

    // Actions
    addProductToCart,
    handleSelectProduct,
    handleWeightConfirm,
    handleScan,
    handleSearchKeyDown,
  };
}
