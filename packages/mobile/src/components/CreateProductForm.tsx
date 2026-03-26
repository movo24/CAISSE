// ── CreateProductForm ────────────────────────────────────────────
// Bottom sheet form to create a new product after scan returns 404.
// EAN is pre-filled from the scanned barcode.
//
// Required fields: nom, prix de vente
// Optional: catégorie, prix d'achat, stock initial, seuil alerte, TVA
//
// On success: returns the created product so ScanPage can show it.
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react';
import {
  X, PackagePlus, Check, Loader2, ChevronDown, Plus,
} from 'lucide-react';
import { productsApi } from '../services/api';
import { ProductImagePicker } from './ProductImagePicker';

interface CreateProductFormProps {
  ean: string;
  onCreated: (product: any) => void;
  onClose: () => void;
}

export function CreateProductForm({ ean, onCreated, onClose }: CreateProductFormProps) {
  const [name, setName] = useState('');
  const [priceSale, setPriceSale] = useState(''); // €, string for input
  const [priceCost, setPriceCost] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [taxRate, setTaxRate] = useState('20');
  const [stockInitial, setStockInitial] = useState('0');
  const [alertThreshold, setAlertThreshold] = useState('10');
  const [description, setDescription] = useState('');
  const [productImage, setProductImage] = useState<string | null>(null);

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [catSearch, setCatSearch] = useState('');
  const [catOpen, setCatOpen] = useState(false);
  const [creatingCat, setCreatingCat] = useState(false);
  const catRef = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load categories
  useEffect(() => {
    productsApi.categories()
      .then((res) => {
        const cats = res.data;
        if (Array.isArray(cats)) setCategories(cats.filter((c: any) => c && c.id));
      })
      .catch(() => {});
  }, []);

  // Close category dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (catRef.current && !catRef.current.contains(e.target as Node)) setCatOpen(false);
    };
    if (catOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [catOpen]);

  const selectedCatName = categories.find((c) => c.id === categoryId)?.name || '';
  const filteredCats = categories.filter((c) =>
    c.name.toLowerCase().includes(catSearch.toLowerCase()),
  );
  const canCreateNewCat = catSearch.trim().length > 0 && !filteredCats.some(
    (c) => c.name.toLowerCase() === catSearch.trim().toLowerCase(),
  );

  const handleCreateCategory = async () => {
    if (!catSearch.trim() || creatingCat) return;
    setCreatingCat(true);
    try {
      const res = await productsApi.createCategory(catSearch.trim());
      const newCat = res.data;
      setCategories((prev) => [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryId(newCat.id);
      setCatSearch('');
      setCatOpen(false);
    } catch {
      // silently fail — user can retry
    } finally {
      setCreatingCat(false);
    }
  };

  const handleSubmit = async () => {
    // Validation
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Le nom du produit est obligatoire');
      return;
    }

    const priceEuros = parseFloat(priceSale.replace(',', '.'));
    if (isNaN(priceEuros) || priceEuros < 0) {
      setError('Le prix de vente est invalide');
      return;
    }

    const priceMinorUnits = Math.round(priceEuros * 100);
    const costEuros = priceCost ? parseFloat(priceCost.replace(',', '.')) : undefined;
    const costMinorUnits = costEuros != null && !isNaN(costEuros) ? Math.round(costEuros * 100) : undefined;
    const tax = parseFloat(taxRate.replace(',', '.'));
    const stock = parseInt(stockInitial, 10) || 0;
    const threshold = parseInt(alertThreshold, 10) || 10;

    setSubmitting(true);
    setError(null);

    try {
      const res = await productsApi.create({
        ean,
        name: trimmedName,
        priceMinorUnits,
        ...(costMinorUnits != null && { costMinorUnits }),
        ...(categoryId && { categoryId }),
        taxRate: isNaN(tax) ? 20 : tax,
        stockQuantity: Math.max(0, stock),
        stockAlertThreshold: Math.max(0, threshold),
        ...(description.trim() && { description: description.trim() }),
        ...(productImage && { imageUrl: productImage }),
      });

      // Show success feedback, then close after 1.5s
      setSuccess(true);
      setTimeout(() => {
        onCreated(res.data);
      }, 1500);
    } catch (err: any) {
      const rawMsg = err.response?.data?.message;
      const msg = Array.isArray(rawMsg)
        ? rawMsg.join(', ')
        : (rawMsg || err.message || 'Erreur creation produit');
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-elevated sheet-slide-up safe-bottom overflow-y-auto" style={{ maxHeight: 'calc(100% - 60px)' }}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400"
        >
          <X size={16} />
        </button>

        <div className="px-5 pb-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-violet-100 flex items-center justify-center">
              <PackagePlus size={24} className="text-violet-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Nouveau produit</h2>
              <p className="text-xs text-gray-500 font-mono">{ean}</p>
            </div>
          </div>

          {/* Form */}
          <div className="space-y-4">
            {/* Nom (requis) */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Nom du produit <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Coca-Cola 33cl"
                // autoFocus removed — causes iOS keyboard loop
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
            </div>

            {/* Prix de vente (requis) + Prix d'achat */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Prix vente (€) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={priceSale}
                  onChange={(e) => setPriceSale(e.target.value)}
                  placeholder="1.50"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-mono font-bold text-center focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Prix achat (€)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={priceCost}
                  onChange={(e) => setPriceCost(e.target.value)}
                  placeholder="0.80"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>

            {/* Catégorie — dropdown avec recherche + création */}
            <div ref={catRef} className="relative">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Catégorie</label>
              <button
                type="button"
                onClick={() => setCatOpen(!catOpen)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm bg-white flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <span className={selectedCatName ? 'text-gray-900 font-medium' : 'text-gray-400'}>
                  {selectedCatName || '-- Sélectionner --'}
                </span>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${catOpen ? 'rotate-180' : ''}`} />
              </button>

              {catOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-20 max-h-48 overflow-hidden">
                  {/* Search */}
                  <div className="p-2 border-b border-gray-100">
                    <input
                      type="text"
                      value={catSearch}
                      onChange={(e) => setCatSearch(e.target.value)}
                      placeholder="Rechercher ou créer..."
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500"
                      // autoFocus removed — causes iOS keyboard loop
                    />
                  </div>

                  {/* Options */}
                  <div className="overflow-y-auto max-h-32">
                    {/* None option */}
                    <button
                      type="button"
                      onClick={() => { setCategoryId(''); setCatOpen(false); setCatSearch(''); }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${!categoryId ? 'text-violet-600 font-semibold' : 'text-gray-500'}`}
                    >
                      -- Aucune --
                    </button>

                    {filteredCats.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => { setCategoryId(cat.id); setCatOpen(false); setCatSearch(''); }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${categoryId === cat.id ? 'text-violet-600 font-semibold bg-violet-50' : 'text-gray-700'}`}
                      >
                        {cat.name}
                      </button>
                    ))}

                    {filteredCats.length === 0 && !canCreateNewCat && (
                      <p className="text-center text-[10px] text-gray-400 py-2">Aucune catégorie</p>
                    )}
                  </div>

                  {/* Create new */}
                  {canCreateNewCat && (
                    <button
                      type="button"
                      onClick={handleCreateCategory}
                      disabled={creatingCat}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-violet-600 bg-violet-50 border-t border-gray-100 hover:bg-violet-100 transition-colors"
                    >
                      {creatingCat ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      Créer « {catSearch.trim()} »
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* TVA + Stock initial */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">TVA (%)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Stock initial</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={stockInitial}
                  onChange={(e) => setStockInitial(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>

            {/* Seuil d'alerte */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Seuil alerte stock</label>
              <input
                type="text"
                inputMode="numeric"
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(e.target.value)}
                placeholder="10"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>

            {/* Photo produit */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">Photo du produit</label>
              <ProductImagePicker
                currentImage={productImage}
                onImageSelected={(dataUrl) => setProductImage(dataUrl)}
                onImageRemoved={() => setProductImage(null)}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Description (optionnel)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Notes, variante, fournisseur..."
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>

          {/* Success overlay */}
          {success && (
            <div className="mt-5 py-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex flex-col items-center gap-2 animate-fade-in">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <Check size={24} className="text-emerald-600" />
              </div>
              <p className="text-sm font-bold text-emerald-700">Produit créé !</p>
              <p className="text-xs text-emerald-600">Fermeture automatique...</p>
            </div>
          )}

          {/* Error */}
          {error && !success && (
            <p className="text-xs text-red-600 text-center mt-3 font-medium">{error}</p>
          )}

          {/* Submit */}
          {!success && (
            <button
              onClick={handleSubmit}
              disabled={submitting || !name.trim() || !priceSale}
              className="w-full mt-5 py-3.5 rounded-2xl bg-violet-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.97] transition-transform"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Création...
                </>
              ) : (
                <>
                  <Check size={16} />
                  Créer le produit
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
