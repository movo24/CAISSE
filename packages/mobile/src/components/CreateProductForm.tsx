// ── CreateProductForm ────────────────────────────────────────────
// Bottom sheet form to create a new product after scan returns 404.
// EAN is pre-filled from the scanned barcode.
//
// Required fields: nom, prix de vente
// Optional: catégorie, prix d'achat, stock initial, seuil alerte, TVA
//
// On success: returns the created product so ScanPage can show it.
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import {
  X, PackagePlus, Check, Loader2, ChevronDown,
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

  const [categories, setCategories] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load categories
  useEffect(() => {
    productsApi.categories()
      .then((res) => {
        const cats = res.data;
        if (Array.isArray(cats)) setCategories(cats.filter(Boolean));
      })
      .catch(() => {});
  }, []);

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
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-elevated sheet-slide-up safe-bottom max-h-[90vh] overflow-y-auto">
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
                autoFocus
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

            {/* Catégorie — select existante ou saisie libre */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Catégorie</label>
              {categories.length > 0 ? (
                <div className="relative">
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm appearance-none bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    <option value="">-- Aucune --</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              ) : (
                <input
                  type="text"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  placeholder="Ex: Boissons, Snacks, Confiserie..."
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
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
