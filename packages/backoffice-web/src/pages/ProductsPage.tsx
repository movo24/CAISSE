import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  Package,
  Pencil,
  Zap,
  Trash2,
  ArrowUpDown,
  Download,
  Upload,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  X,
  Columns3,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Bookmark,
} from 'lucide-react';
import { productsApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useCurrentStoreId } from '../hooks/useCurrentStoreId';
import { PriceAnalyticsPanel } from '../components/PriceAnalyticsPanel';
import { validateProductForm, apiErrorMessage, buildCreatePayload, buildUpdatePayload } from './productForm';

interface Product {
  id: string;
  ean: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  image: string | null;
  description: string;
  cost: number | null; // prix d'achat en euros (null si non renseigné)
  taxRate: number | null; // % TVA
  sku: string;
  brandId: string;
  supplierId: string;
  status: string;
  oldPrice: number | null; // prix barré en euros (null si non renseigné)
}

interface RefItem {
  id: string;
  name: string;
}

interface CatItem {
  id: string;
  name: string;
  parentId: string | null;
}

interface CatalogStats {
  total: number;
  active: number;
  outOfStock: number;
  belowThreshold: number;
  noImage: number;
  noSupplier: number;
  noCategory: number;
}

/** Colonnes optionnelles (Nom et Actions sont toujours affichées). */
const COLUMN_DEFS: { key: string; label: string }[] = [
  { key: 'sku', label: 'SKU' },
  { key: 'ean', label: 'EAN' },
  { key: 'category', label: 'Catégorie' },
  { key: 'brand', label: 'Marque' },
  { key: 'supplier', label: 'Fournisseur' },
  { key: 'tva', label: 'TVA' },
  { key: 'cost', label: "Prix d'achat" },
  { key: 'priceTtc', label: 'Prix TTC' },
  { key: 'margin', label: 'Marge' },
  { key: 'stock', label: 'Stock' },
  { key: 'status', label: 'Statut' },
];
const DEFAULT_COLS = ['ean', 'category', 'brand', 'priceTtc', 'stock', 'status'];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: 'Actif', cls: 'bg-emerald-50 text-emerald-600' },
  draft: { label: 'Brouillon', cls: 'bg-gray-100 text-gray-500' },
  archived: { label: 'Archivé', cls: 'bg-gray-100 text-gray-400' },
  pending_validation: { label: 'En validation', cls: 'bg-amber-50 text-amber-600' },
  rejected: { label: 'Rejeté', cls: 'bg-red-50 text-red-600' },
};

const avatarColors = [
  'from-indigo-100 to-indigo-200 text-indigo-600',
  'from-rose-100 to-rose-200 text-rose-600',
  'from-emerald-100 to-emerald-200 text-emerald-600',
  'from-amber-100 to-amber-200 text-amber-600',
  'from-cyan-100 to-cyan-200 text-cyan-600',
  'from-violet-100 to-violet-200 text-violet-600',
  'from-pink-100 to-pink-200 text-pink-600',
  'from-teal-100 to-teal-200 text-teal-600',
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function stockBadge(stock: number) {
  if (stock <= 5) return { color: 'bg-red-50 text-red-600 ring-red-200', icon: XCircle, label: 'Critique' };
  if (stock <= 15) return { color: 'bg-amber-50 text-amber-600 ring-amber-200', icon: AlertTriangle, label: 'Faible' };
  return { color: 'bg-emerald-50 text-emerald-600 ring-emerald-200', icon: CheckCircle2, label: 'OK' };
}

export function ProductsPage() {
  const navigate = useNavigate();
  const employee = useAuthStore((s) => s.employee);
  const storeId = useCurrentStoreId();
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const LIMIT = 50;
  const [loading, setLoading] = useState(true);
  // Ne devient true qu'après la PREMIÈRE réponse : le spinner plein-page ne
  // s'affiche qu'au premier chargement. Ensuite, la page (et le champ de
  // recherche) restent TOUJOURS montés — seul le tableau montre un chargement
  // discret. (Bug 2026-07-23 : chaque frappe démontait la page → focus perdu.)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Numéro de séquence des requêtes liste : une réponse en retard (obsolète)
  // ne doit jamais écraser le résultat de la recherche la plus récente.
  const fetchSeqRef = useRef(0);
  const [error, setError] = useState<string | null>(null);

  // ── Filtres serveur ──
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fStatus, setFStatus] = useState('active');
  const [fBrand, setFBrand] = useState('');
  const [fSupplier, setFSupplier] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fTax, setFTax] = useState('');
  const [fOutOfStock, setFOutOfStock] = useState(false);
  const [fBelowThreshold, setFBelowThreshold] = useState(false);
  const [fNoImage, setFNoImage] = useState(false);
  const [fNoSupplier, setFNoSupplier] = useState(false);
  const [fNoCategory, setFNoCategory] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'stock' | 'updatedAt'>('name');
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>('ASC');

  const [stats, setStats] = useState<CatalogStats | null>(null);

  // Colonnes configurables (persistées)
  const [visibleCols, setVisibleCols] = useState<string[]>(() => {
    try { const s = localStorage.getItem('catalog.columns'); if (s) return JSON.parse(s); } catch { /* noop */ }
    return DEFAULT_COLS;
  });
  const [showColMenu, setShowColMenu] = useState(false);
  useEffect(() => {
    try { localStorage.setItem('catalog.columns', JSON.stringify(visibleCols)); } catch { /* noop */ }
  }, [visibleCols]);
  const colOn = (k: string) => visibleCols.includes(k);
  const toggleCol = (k: string) =>
    setVisibleCols((cols) => (cols.includes(k) ? cols.filter((c) => c !== k) : [...cols, k]));

  // Vues enregistrables (filtres + colonnes) — persistées (Lot J)
  const [savedViews, setSavedViews] = useState<Array<{ name: string; v: any }>>(() => {
    try { const s = localStorage.getItem('catalog.views'); if (s) return JSON.parse(s); } catch { /* noop */ }
    return [];
  });
  const [showViewsMenu, setShowViewsMenu] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const persistViews = (views: Array<{ name: string; v: any }>) => {
    setSavedViews(views);
    try { localStorage.setItem('catalog.views', JSON.stringify(views)); } catch { /* noop */ }
  };

  // Modal state (édition rapide secondaire)
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', ean: '', price: '', stock: '', category: '', description: '', cost: '', taxRate: '', sku: '', brandId: '', supplierId: '', status: 'active', oldPrice: '' });
  const [formError, setFormError] = useState<string | null>(null);

  // Price analytics panel
  const [analyticsProductId, setAnalyticsProductId] = useState<string | null>(null);

  // Référentiels (marques / fournisseurs / catégories) pour filtres + fiche rapide.
  const [brands, setBrands] = useState<RefItem[]>([]);
  const [suppliers, setSuppliers] = useState<RefItem[]>([]);
  const [categoryRefs, setCategoryRefs] = useState<CatItem[]>([]);

  const fetchProducts = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      setLoading(true);
      const res = await productsApi.list({
        storeId,
        page,
        limit: LIMIT,
        search: debouncedSearch || undefined,
        status: fStatus || undefined,
        brandId: fBrand || undefined,
        supplierId: fSupplier || undefined,
        categoryId: fCategory || undefined,
        ...(fTax ? { taxRate: fTax } : {}),
        ...(fOutOfStock ? { outOfStock: fOutOfStock } : {}),
        ...(fBelowThreshold ? { belowThreshold: fBelowThreshold } : {}),
        ...(fNoImage ? { noImage: fNoImage } : {}),
        ...(fNoSupplier ? { noSupplier: fNoSupplier } : {}),
        ...(fNoCategory ? { noCategory: fNoCategory } : {}),
        sortBy,
        sortDir,
      } as any);
      if (seq !== fetchSeqRef.current) return; // réponse obsolète — une recherche plus récente est partie
      const body: any = res.data;
      const data: any[] = Array.isArray(body) ? body : (body?.data || body?.products || []);
      setTotal(body?.meta?.total ?? data.length);
      setProducts(
        data.map((p: any) => ({
          id: p.id,
          ean: p.ean || '',
          name: p.name || '',
          price: (p.priceMinorUnits || 0) / 100,
          stock: p.stockQuantity ?? 0,
          category: typeof p.categoryId === 'string' ? p.categoryId : (typeof p.category === 'string' ? p.category : ''),
          image: p.imageUrl || null,
          description: typeof p.description === 'string' ? p.description : '',
          cost: typeof p.costMinorUnits === 'number' ? p.costMinorUnits / 100 : null,
          taxRate: typeof p.taxRate === 'number' ? p.taxRate : (p.taxRate != null ? Number(p.taxRate) : null),
          sku: typeof p.sku === 'string' ? p.sku : '',
          brandId: typeof p.brandId === 'string' ? p.brandId : '',
          supplierId: typeof p.supplierId === 'string' ? p.supplierId : '',
          status: typeof p.status === 'string' ? p.status : 'active',
          oldPrice: typeof p.oldPriceMinorUnits === 'number' ? p.oldPriceMinorUnits / 100 : null,
        })),
      );
      setError(null);
    } catch (err: any) {
      if (seq !== fetchSeqRef.current) return; // erreur d'une requête obsolète — ignore
      const msg = err.response?.data?.message;
      setError(typeof msg === 'string' ? msg : Array.isArray(msg) ? msg.join(', ') : 'Erreur lors du chargement des produits');
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false);
        setHasLoadedOnce(true);
      }
    }
  }, [storeId, page, debouncedSearch, fStatus, fBrand, fSupplier, fCategory, fTax, fOutOfStock, fBelowThreshold, fNoImage, fNoSupplier, fNoCategory, sortBy, sortDir]);

  const fetchStats = useCallback(async () => {
    try {
      const r = await productsApi.catalogStats({ storeId });
      setStats(r.data as CatalogStats);
    } catch { /* compteurs non bloquants */ }
  }, [storeId]);

  const fetchRefs = useCallback(async () => {
    try {
      const [b, s, c] = await Promise.all([
        productsApi.listBrands(),
        productsApi.listSuppliers(),
        productsApi.listCategories(),
      ]);
      setBrands((b.data || []).map((x: any) => ({ id: x.id, name: x.name })));
      setSuppliers((s.data || []).map((x: any) => ({ id: x.id, name: x.name })));
      setCategoryRefs((c.data || []).map((x: any) => ({ id: x.id, name: x.name, parentId: x.parentId ?? null })));
    } catch {
      /* référentiels non bloquants */
    }
  }, []);

  // Recherche débouncée (retour page 1)
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  // Un changement de filtre/tri repart page 1
  useEffect(() => { setPage(1); }, [fStatus, fBrand, fSupplier, fCategory, fTax, fOutOfStock, fBelowThreshold, fNoImage, fNoSupplier, fNoCategory, sortBy, sortDir]);
  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { fetchStats(); fetchRefs(); }, [fetchStats, fetchRefs]);

  const reload = useCallback(() => { fetchProducts(); fetchStats(); }, [fetchProducts, fetchStats]);

  const resetFilters = () => {
    setSearch(''); setDebouncedSearch('');
    setFStatus('active'); setFBrand(''); setFSupplier(''); setFCategory(''); setFTax('');
    setFOutOfStock(false); setFBelowThreshold(false); setFNoImage(false); setFNoSupplier(false); setFNoCategory(false);
    setSortBy('name'); setSortDir('ASC'); setPage(1);
  };

  const captureView = () => ({
    search, fStatus, fBrand, fSupplier, fCategory, fTax,
    fOutOfStock, fBelowThreshold, fNoImage, fNoSupplier, fNoCategory,
    sortBy, sortDir, visibleCols,
  });
  const saveCurrentView = () => {
    const name = newViewName.trim();
    if (!name) return;
    persistViews([...savedViews.filter((x) => x.name !== name), { name, v: captureView() }]);
    setNewViewName('');
  };
  const applyView = (view: { name: string; v: any }) => {
    const v = view.v || {};
    setSearch(v.search ?? ''); setDebouncedSearch(v.search ?? '');
    setFStatus(v.fStatus ?? 'active'); setFBrand(v.fBrand ?? ''); setFSupplier(v.fSupplier ?? '');
    setFCategory(v.fCategory ?? ''); setFTax(v.fTax ?? '');
    setFOutOfStock(!!v.fOutOfStock); setFBelowThreshold(!!v.fBelowThreshold); setFNoImage(!!v.fNoImage);
    setFNoSupplier(!!v.fNoSupplier); setFNoCategory(!!v.fNoCategory);
    setSortBy(v.sortBy ?? 'name'); setSortDir(v.sortDir ?? 'ASC');
    if (Array.isArray(v.visibleCols)) setVisibleCols(v.visibleCols);
    setPage(1); setShowViewsMenu(false);
  };
  const deleteView = (name: string) => persistViews(savedViews.filter((x) => x.name !== name));

  const toggleSort = (key: 'name' | 'price' | 'stock' | 'updatedAt') => {
    if (sortBy === key) setSortDir(sortDir === 'ASC' ? 'DESC' : 'ASC');
    else { setSortBy(key); setSortDir('ASC'); }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const catName = (id: string) => categoryRefs.find((c) => c.id === id)?.name || id;
  const brandName = (id: string) => brands.find((b) => b.id === id)?.name || '';
  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name || '';
  const activeFilterCount =
    (debouncedSearch ? 1 : 0) + (fStatus !== 'active' ? 1 : 0) + (fBrand ? 1 : 0) + (fSupplier ? 1 : 0) +
    (fCategory ? 1 : 0) + (fTax ? 1 : 0) + (fOutOfStock ? 1 : 0) + (fBelowThreshold ? 1 : 0) +
    (fNoImage ? 1 : 0) + (fNoSupplier ? 1 : 0) + (fNoCategory ? 1 : 0);

  // ── Sélection + actions de masse ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const allOnPageSelected = products.length > 0 && products.every((p) => selected.has(p.id));
  const toggleSelect = (id: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleSelectAllPage = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allOnPageSelected) products.forEach((p) => n.delete(p.id));
      else products.forEach((p) => n.add(p.id));
      return n;
    });
  const clearSelection = () => setSelected(new Set());

  const executeBulk = async (
    action: 'activate' | 'deactivate' | 'setCategory' | 'setSupplier' | 'setTax',
    extra: { categoryId?: string; supplierId?: string; taxRate?: number } = {},
  ) => {
    const productIds = [...selected];
    if (productIds.length === 0) return;
    if (action === 'deactivate' && !confirm(`Désactiver ${productIds.length} produit(s) ?`)) return;
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      const res = await productsApi.bulk({ action, productIds, ...extra });
      const r: any = res.data;
      setBulkMsg(`${r.succeeded} produit(s) mis à jour${r.failed?.length ? `, ${r.failed.length} échec(s)` : ''}.`);
      clearSelection();
      reload();
    } catch (err: any) {
      const m = err?.response?.data?.message;
      setBulkMsg(typeof m === 'string' ? m : Array.isArray(m) ? m.join(', ') : 'Action de masse impossible');
    } finally {
      setBulkBusy(false);
      setTimeout(() => setBulkMsg(null), 4000);
    }
  };

  const exportSelection = () => {
    const rows = products.filter((p) => selected.has(p.id));
    if (rows.length === 0) return;
    const header = ['Nom', 'EAN', 'SKU', 'Categorie', 'Prix (EUR)', 'Stock'];
    const csvRows = rows.map((p) => [p.name, p.ean, p.sku, catName(p.category), p.price.toFixed(2), String(p.stock)]);
    const escapeCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [header, ...csvRows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selection-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ── Onboarding catalogue (PR #29) — import CSV serveur + modèle round-trip ── */
  interface ImportReport {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ line: number; ean: string; reason: string }>;
  }
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleImportFile = async (file: File) => {
    setImporting(true);
    setImportError(null);
    try {
      const csv = await file.text();
      const res = await productsApi.importCsv(csv);
      // Rapport honnête par ligne : rien n'est silencieusement ignoré.
      setImportReport(res.data as ImportReport);
      reload(); // le catalogue + compteurs reflètent l'état réel post-import
    } catch (err: any) {
      setImportError(err?.response?.data?.message || err?.message || 'Import impossible');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  /** Modèle/export canonique SERVEUR — round-trippable avec l'import (colonnes officielles). */
  const handleExportServerCsv = async () => {
    try {
      const res = await productsApi.exportCsv();
      const blob = new Blob(['﻿' + (res.data as string)], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `catalogue-import-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setImportError(err?.response?.data?.message || 'Export serveur impossible');
    }
  };

  const handleExportCsv = () => {
    if (products.length === 0) return;
    const header = ['Nom', 'EAN', 'SKU', 'Categorie', 'Prix (EUR)', 'Stock'];
    const rows = products.map((p) => [p.name, p.ean, p.sku, catName(p.category), p.price.toFixed(2), String(p.stock)]);
    const escapeCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
    // Prepend BOM so Excel detects UTF-8
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `produits-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const resetForm = () => {
    setForm({ name: '', ean: '', price: '', stock: '', category: '', description: '', cost: '', taxRate: '', sku: '', brandId: '', supplierId: '', status: 'active', oldPrice: '' });
    setEditingId(null);
    setFormError(null);
  };

  const [originalPrice, setOriginalPrice] = useState<number | null>(null);
  const [priceConfirm, setPriceConfirm] = useState(false);

  const openEdit = (p: Product) => {
    setForm({
      name: p.name,
      ean: p.ean,
      price: String(p.price),
      stock: String(p.stock),
      category: p.category === 'Non classe' ? '' : p.category,
      description: p.description,
      cost: p.cost != null ? String(p.cost) : '',
      taxRate: p.taxRate != null ? String(p.taxRate) : '',
      sku: p.sku,
      brandId: p.brandId,
      supplierId: p.supplierId,
      status: p.status || 'active',
      oldPrice: p.oldPrice != null ? String(p.oldPrice) : '',
    });
    setOriginalPrice(p.price);
    setEditingId(p.id);
    setFormError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    // Validation client alignée sur les DTO (name + ean-si-création + prix).
    const validationError = validateProductForm(form, editingId !== null);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError(null);

    // Confirmation de changement de prix en modification.
    const newPrice = Math.round(parseFloat(form.price || '0') * 100);
    if (editingId && originalPrice !== null) {
      const oldPriceCents = Math.round(originalPrice * 100);
      if (oldPriceCents !== newPrice && !priceConfirm) {
        setPriceConfirm(true);
        return;
      }
    }
    setPriceConfirm(false);

    try {
      setSaving(true);
      if (editingId) {
        // UpdateProductDto : jamais `ean` ni `storeId`. `reason` trace le changement de prix.
        const changedPrice = originalPrice !== null && Math.round(originalPrice * 100) !== newPrice;
        await productsApi.update(
          editingId,
          buildUpdatePayload(form, changedPrice ? 'Modification via backoffice' : undefined),
        );
      } else {
        // CreateProductDto : ean+name+priceMinorUnits obligatoires ; storeId forcé serveur.
        await productsApi.create(buildCreatePayload(form));
      }
      setShowModal(false);
      setOriginalPrice(null);
      resetForm();
      reload();
    } catch (err: any) {
      const rawMsg = err.response?.data?.message;
      const msg = typeof rawMsg === 'string' ? rawMsg : Array.isArray(rawMsg) ? rawMsg.join(', ') : 'Erreur lors de la sauvegarde';
      setFormError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce produit ?')) return;
    try {
      await productsApi.delete(id);
      reload();
    } catch (err: any) {
      const delMsg = err.response?.data?.message;
      alert(typeof delMsg === 'string' ? delMsg : Array.isArray(delMsg) ? delMsg.join(', ') : 'Erreur lors de la suppression');
    }
  };

  // Spinner plein-page UNIQUEMENT avant la toute première réponse. Ensuite la
  // page ne se démonte plus jamais : la saisie reste fluide, le focus reste
  // dans le champ, et seul le tableau signale les rafraîchissements.
  if (!hasLoadedOnce) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 size={32} className="animate-spin text-bo-accent" />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchProducts} className="text-red-600 font-medium hover:underline">
            Réessayer
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-bo-text">Catalogue Produits</h2>
          <p className="text-gray-400 mt-1 text-sm">
            {products.length} references en catalogue
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); }}
          />
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            title="Importer / mettre à jour le catalogue depuis un CSV (colonnes du modèle serveur)"
          >
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {importing ? 'Import...' : 'Importer CSV'}
          </button>
          <button
            onClick={handleExportServerCsv}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            title="Télécharger le catalogue au format d'import (modèle round-trip serveur)"
          >
            <Download size={16} />
            Modèle / Export serveur
          </button>
          <button
            onClick={handleExportCsv}
            disabled={products.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            title="Exporter la page courante en CSV"
          >
            <Download size={16} />
            Exporter
          </button>
          <button
            onClick={() => navigate('/products/new')}
            className="flex items-center gap-2 bg-bo-accent text-white px-5 py-2.5 rounded-xl font-medium hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/25"
          >
            <Plus size={16} />
            Nouveau produit
          </button>
        </div>
      </div>

      {/* Stats en-t\u00eate (compteurs r\u00e9els serveur) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total fiches', value: stats?.total, icon: Package, color: 'text-bo-accent bg-indigo-50', filter: null as null | (() => void), on: false },
          { label: 'Actifs', value: stats?.active, icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50', filter: () => setFStatus('active'), on: fStatus === 'active' },
          { label: 'Ruptures', value: stats?.outOfStock, icon: XCircle, color: 'text-red-600 bg-red-50', filter: () => setFOutOfStock((v) => !v), on: fOutOfStock },
          { label: 'Sous seuil', value: stats?.belowThreshold, icon: AlertTriangle, color: 'text-amber-600 bg-amber-50', filter: () => setFBelowThreshold((v) => !v), on: fBelowThreshold },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.label}
              onClick={s.filter ?? undefined}
              className={`text-left bg-white rounded-2xl p-4 shadow-soft border flex items-center gap-4 transition-colors ${s.on ? 'border-bo-accent ring-1 ring-bo-accent/30' : 'border-gray-100/50'} ${s.filter ? 'hover:border-bo-accent/50 cursor-pointer' : 'cursor-default'}`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}>
                <Icon size={18} />
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium">{s.label}</p>
                <p className="text-lg font-bold text-bo-text tabular-nums">{s.value ?? '\u2014'}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filtres serveur */}
      <div className="bg-white rounded-2xl shadow-soft border border-gray-100/50 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Rechercher par nom, nom caisse, EAN ou SKU..."
              className="w-full pl-10 pr-9 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {loading && (
              <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-bo-accent/60" aria-label="Recherche en cours" />
            )}
          </div>
          <select className="py-2.5 px-3 rounded-xl border border-gray-200 bg-white text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-bo-accent/30" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="active">Actifs</option>
            <option value="all">Tous statuts</option>
            <option value="draft">Brouillons</option>
            <option value="archived">Archivés</option>
            <option value="pending_validation">En validation</option>
            <option value="rejected">Rejetés</option>
          </select>
          <select className="py-2.5 px-3 rounded-xl border border-gray-200 bg-white text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-bo-accent/30" value={fBrand} onChange={(e) => setFBrand(e.target.value)}>
            <option value="">Toutes marques</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="py-2.5 px-3 rounded-xl border border-gray-200 bg-white text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-bo-accent/30" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}>
            <option value="">Tous fournisseurs</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="py-2.5 px-3 rounded-xl border border-gray-200 bg-white text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-bo-accent/30" value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
            <option value="">Toutes catégories</option>
            {categoryRefs.map((c) => <option key={c.id} value={c.id}>{c.parentId ? '— ' : ''}{c.name}</option>)}
          </select>
          <select className="py-2.5 px-3 rounded-xl border border-gray-200 bg-white text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-bo-accent/30" value={fTax} onChange={(e) => setFTax(e.target.value)}>
            <option value="">Toute TVA</option>
            {['0', '2.1', '5.5', '10', '20'].map((r) => <option key={r} value={r}>{r} %</option>)}
          </select>
          <div className="relative">
            <button onClick={() => setShowColMenu((v) => !v)} className="flex items-center gap-1.5 py-2.5 px-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"><Columns3 size={15} /> Colonnes</button>
            {showColMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowColMenu(false)} />
                <div className="absolute right-0 mt-1 z-20 bg-white rounded-xl border border-gray-100 shadow-elevated p-2 w-48">
                  {COLUMN_DEFS.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={colOn(c.key)} onChange={() => toggleCol(c.key)} className="accent-bo-accent" /> {c.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* Vues enregistrables (Lot J) */}
          <div className="relative">
            <button onClick={() => setShowViewsMenu((v) => !v)} className="flex items-center gap-1.5 py-2.5 px-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"><Bookmark size={15} /> Vues{savedViews.length > 0 ? ` (${savedViews.length})` : ''}</button>
            {showViewsMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowViewsMenu(false)} />
                <div className="absolute right-0 mt-1 z-20 bg-white rounded-xl border border-gray-100 shadow-elevated p-2 w-64">
                  <div className="flex items-center gap-1.5 px-1 pb-1.5">
                    <input
                      value={newViewName}
                      onChange={(e) => setNewViewName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveCurrentView(); }}
                      placeholder="Nom de la vue…"
                      className="flex-1 min-w-0 py-1.5 px-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                    />
                    <button
                      onClick={saveCurrentView}
                      disabled={!newViewName.trim()}
                      title="Sauvegarder la vue actuelle"
                      className="p-1.5 rounded-lg text-bo-accent hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    ><Plus size={16} /></button>
                  </div>
                  {savedViews.length > 0 && <div className="border-t border-gray-50 my-1" />}
                  {savedViews.length === 0 && <p className="px-2 py-1.5 text-xs text-gray-400">Aucune vue enregistrée.</p>}
                  {savedViews.map((view) => (
                    <div key={view.name} className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-50 group">
                      <button onClick={() => applyView(view)} className="flex-1 text-left text-sm text-gray-700 truncate">{view.name}</button>
                      <button onClick={() => deleteView(view.name)} className="p-1 text-red-400 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          {activeFilterCount > 0 && (
            <button onClick={resetFilters} className="flex items-center gap-1.5 py-2.5 px-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"><RotateCcw size={14} /> Réinitialiser ({activeFilterCount})</button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { label: 'Ruptures', on: fOutOfStock, set: () => setFOutOfStock((v) => !v) },
            { label: 'Sous seuil', on: fBelowThreshold, set: () => setFBelowThreshold((v) => !v) },
            { label: 'Sans image', on: fNoImage, set: () => setFNoImage((v) => !v) },
            { label: 'Sans fournisseur', on: fNoSupplier, set: () => setFNoSupplier((v) => !v) },
            { label: 'Sans catégorie', on: fNoCategory, set: () => setFNoCategory((v) => !v) },
          ].map((chip) => (
            <button key={chip.label} onClick={chip.set} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${chip.on ? 'bg-bo-accent text-white border-bo-accent' : 'bg-white text-gray-500 border-gray-200 hover:border-bo-accent/50'}`}>
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Barre d'actions de masse */}
      {selected.size > 0 && (
        <div className="bg-bo-accent/5 border border-bo-accent/30 rounded-2xl p-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-bo-text px-2">{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span>
          <button disabled={bulkBusy} onClick={() => executeBulk('activate')} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Activer</button>
          <button disabled={bulkBusy} onClick={() => executeBulk('deactivate')} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Désactiver</button>
          <select disabled={bulkBusy} defaultValue="" onChange={(e) => { const v = e.target.value; e.currentTarget.value = ''; if (v) executeBulk('setCategory', { categoryId: v }); }} className="px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-sm cursor-pointer">
            <option value="">Catégorie…</option>
            {categoryRefs.map((c) => <option key={c.id} value={c.id}>{c.parentId ? '— ' : ''}{c.name}</option>)}
          </select>
          <select disabled={bulkBusy} defaultValue="" onChange={(e) => { const v = e.target.value; e.currentTarget.value = ''; if (v) executeBulk('setSupplier', { supplierId: v }); }} className="px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-sm cursor-pointer">
            <option value="">Fournisseur…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select disabled={bulkBusy} defaultValue="" onChange={(e) => { const v = e.target.value; e.currentTarget.value = ''; if (v !== '') executeBulk('setTax', { taxRate: Number(v) }); }} className="px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-sm cursor-pointer">
            <option value="">TVA…</option>
            {['0', '2.1', '5.5', '10', '20'].map((r) => <option key={r} value={r}>{r} %</option>)}
          </select>
          <button disabled={bulkBusy} onClick={exportSelection} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">Exporter</button>
          <div className="flex-1" />
          {bulkBusy && <Loader2 size={16} className="animate-spin text-bo-accent" />}
          {bulkMsg && <span className="text-sm text-bo-text">{bulkMsg}</span>}
          <button onClick={clearSelection} className="p-1.5 rounded-lg text-gray-500 hover:bg-white" title="Désélectionner tout"><X size={16} /></button>
        </div>
      )}

      {/* Table serveur — chargement DISCRET : les lignes précédentes restent
          affichées (légèrement estompées), jamais de démontage de la page. */}
      <div className={`bg-white rounded-2xl shadow-soft border border-gray-100/50 overflow-x-auto transition-opacity duration-150 ${loading ? 'opacity-60' : ''}`}>
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="w-10 py-3.5 px-4">
                <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllPage} className="accent-bo-accent" aria-label="Tout sélectionner" />
              </th>
              <th className="text-left py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-bo-accent" onClick={() => toggleSort('name')}>
                <span className="flex items-center gap-1">Produit <ArrowUpDown size={12} className={sortBy === 'name' ? 'text-bo-accent' : ''} /></span>
              </th>
              {colOn('sku') && <th className="text-left py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">SKU</th>}
              {colOn('ean') && <th className="text-left py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">EAN</th>}
              {colOn('category') && <th className="text-left py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Catégorie</th>}
              {colOn('brand') && <th className="text-left py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Marque</th>}
              {colOn('supplier') && <th className="text-left py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Fournisseur</th>}
              {colOn('tva') && <th className="text-right py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">TVA</th>}
              {colOn('cost') && <th className="text-right py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Achat</th>}
              {colOn('priceTtc') && (
                <th className="text-right py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-bo-accent" onClick={() => toggleSort('price')}>
                  <span className="flex items-center justify-end gap-1">Prix TTC <ArrowUpDown size={12} className={sortBy === 'price' ? 'text-bo-accent' : ''} /></span>
                </th>
              )}
              {colOn('margin') && <th className="text-right py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Marge</th>}
              {colOn('stock') && (
                <th className="text-right py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-bo-accent" onClick={() => toggleSort('stock')}>
                  <span className="flex items-center justify-end gap-1">Stock <ArrowUpDown size={12} className={sortBy === 'stock' ? 'text-bo-accent' : ''} /></span>
                </th>
              )}
              {colOn('status') && <th className="text-left py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Statut</th>}
              <th className="text-right py-3.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const badge = stockBadge(product.stock);
              const BadgeIcon = badge.icon;
              const ht = product.taxRate != null ? product.price / (1 + product.taxRate / 100) : null;
              const margin = ht != null && product.cost != null ? ht - product.cost : null;
              const colCount = 3 + visibleCols.length;
              const st = STATUS_META[product.status] || { label: product.status, cls: 'bg-gray-100 text-gray-500' };
              return (
                <React.Fragment key={product.id}>
                  <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors group cursor-pointer" onClick={() => navigate(`/products/${product.id}`)}>
                    <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(product.id)} onChange={() => toggleSelect(product.id)} className="accent-bo-accent" aria-label={`Sélectionner ${product.name}`} />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl border border-gray-100 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {product.image
                            ? <img src={product.image} alt="" className="max-h-full max-w-full object-contain" />
                            : <span className={`w-full h-full rounded-xl bg-gradient-to-br ${avatarColor(product.name)} flex items-center justify-center font-bold text-sm`}>{product.name.charAt(0)}</span>}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-bo-text truncate">{product.name}</p>
                          <p className="text-[11px] text-gray-400 font-mono">{product.ean}</p>
                        </div>
                      </div>
                    </td>
                    {colOn('sku') && <td className="py-3 px-4 font-mono text-xs text-gray-400">{product.sku || '—'}</td>}
                    {colOn('ean') && <td className="py-3 px-4 font-mono text-xs text-gray-400">{product.ean}</td>}
                    {colOn('category') && <td className="py-3 px-4"><span className="text-xs font-medium px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600">{product.category ? catName(product.category) : '—'}</span></td>}
                    {colOn('brand') && <td className="py-3 px-4 text-sm text-gray-600">{brandName(product.brandId) || '—'}</td>}
                    {colOn('supplier') && <td className="py-3 px-4 text-sm text-gray-600">{supplierName(product.supplierId) || '—'}</td>}
                    {colOn('tva') && <td className="py-3 px-4 text-right text-sm tabular-nums text-gray-600">{product.taxRate != null ? `${product.taxRate} %` : '—'}</td>}
                    {colOn('cost') && <td className="py-3 px-4 text-right text-sm tabular-nums text-gray-600">{product.cost != null ? `${product.cost.toFixed(2).replace('.', ',')} €` : '—'}</td>}
                    {colOn('priceTtc') && <td className="py-3 px-4 text-right font-semibold text-sm tabular-nums">{product.price.toFixed(2).replace('.', ',')} €</td>}
                    {colOn('margin') && <td className={`py-3 px-4 text-right text-sm tabular-nums ${margin != null && margin < 0 ? 'text-red-600' : 'text-gray-600'}`}>{margin != null ? `${margin.toFixed(2).replace('.', ',')} €` : '—'}</td>}
                    {colOn('stock') && (
                      <td className="py-3 px-4 text-right">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ring-1 ${badge.color}`}><BadgeIcon size={12} />{product.stock}</span>
                      </td>
                    )}
                    {colOn('status') && <td className="py-3 px-4"><span className={`text-xs font-medium px-2.5 py-1 rounded-full ${st.cls}`}>{st.label}</span></td>}
                    <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setAnalyticsProductId(analyticsProductId === product.id ? null : product.id)} className={`p-2 rounded-lg transition-colors ${analyticsProductId === product.id ? 'bg-indigo-100 text-bo-accent' : 'hover:bg-indigo-50 text-gray-400 hover:text-bo-accent'}`} title="Historique tarifaire"><BarChart3 size={14} /></button>
                        <button onClick={() => navigate(`/products/${product.id}/edit`)} className="p-2 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-bo-accent transition-colors" title="Fiche complète (modifier)"><Pencil size={14} /></button>
                        <button onClick={() => openEdit(product)} className="p-2 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-bo-accent transition-colors" title="Édition rapide (secondaire)"><Zap size={14} /></button>
                        <button onClick={() => handleDelete(product.id)} className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="Supprimer"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                  {analyticsProductId === product.id && (
                    <tr>
                      <td colSpan={colCount} className="p-0">
                        <div className="px-6 py-4 bg-bo-subtle/50 border-b border-bo-border animate-fade-in">
                          <PriceAnalyticsPanel productId={product.id} />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {!loading && products.length === 0 && (
          <div className="py-12 text-center">
            <Package size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400 text-sm">Aucun produit ne correspond à ces filtres.</p>
            {activeFilterCount > 0 && <button onClick={resetFilters} className="mt-3 text-sm font-medium text-bo-accent hover:underline">Réinitialiser les filtres</button>}
          </div>
        )}

        {/* Footer pagination serveur */}
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>{total.toLocaleString('fr-FR')} produit{total > 1 ? 's' : ''} · page {page}/{totalPages}</span>
          <div className="flex items-center gap-1">
            <button disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))} className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"><ChevronLeft size={15} /></button>
            <button disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"><ChevronRight size={15} /></button>
          </div>
        </div>
      </div>

      {/* Modal Add/Edit Product */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setShowModal(false); resetForm(); }} />
          <div className="relative bg-white rounded-2xl shadow-elevated w-full max-w-2xl p-6 animate-slide-up max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-bo-text">
                Édition rapide
                <span className="ml-2 text-xs font-normal text-gray-400">— fiche complète via l'icône crayon</span>
              </h3>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5">
              {/* ── Identification ── */}
              <section className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Identification</p>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Nom du produit *</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                    placeholder="T-Shirt Blanc"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">
                      Code EAN {editingId ? '' : '*'}
                    </label>
                    <input
                      type="text"
                      disabled={editingId !== null}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder="3760001000001"
                      value={form.ean}
                      onChange={(e) => setForm({ ...form, ean: e.target.value })}
                    />
                    {editingId && <p className="mt-1 text-[11px] text-gray-400">Le code EAN n'est pas modifiable.</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">SKU / Référence interne</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                      placeholder="REF-0001"
                      value={form.sku}
                      onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    />
                    <p className="mt-1 text-[11px] text-gray-400">Unique par magasin.</p>
                  </div>
                </div>
              </section>

              {/* ── Classification ── */}
              <section className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Classification</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Catégorie</label>
                    <select
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                    >
                      <option value="">— Aucune —</option>
                      {categoryRefs.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                      {form.category && !categoryRefs.some((c) => c.id === form.category) && (
                        <option value={form.category}>{form.category} (actuel)</option>
                      )}
                    </select>
                    <p className="mt-1 text-[11px] text-gray-400">Gérées dans Catalogue &gt; Catégories.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Statut</label>
                    <select
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                    >
                      <option value="active">Actif</option>
                      <option value="draft">Brouillon</option>
                      <option value="archived">Archivé</option>
                      {['pending_validation', 'rejected'].includes(form.status) && (
                        <option value={form.status}>{form.status}</option>
                      )}
                    </select>
                    <p className="mt-1 text-[11px] text-gray-400">Seul « Actif » est vendable en caisse.</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Marque</label>
                    <select
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                      value={form.brandId}
                      onChange={(e) => setForm({ ...form, brandId: e.target.value })}
                    >
                      <option value="">— Aucune —</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Fournisseur</label>
                    <select
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                      value={form.supplierId}
                      onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                    >
                      <option value="">— Aucun —</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              {/* ── Prix & fiscalité ── */}
              <section className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Prix &amp; fiscalité</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Prix TTC (EUR)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                      placeholder="29.90"
                      value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Prix barré (EUR)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                      placeholder="39.90"
                      value={form.oldPrice}
                      onChange={(e) => setForm({ ...form, oldPrice: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">TVA (%)</label>
                    <select
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                      value={form.taxRate === '' ? '' : String(form.taxRate)}
                      onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
                    >
                      <option value="">—</option>
                      {['0', '2.1', '5.5', '10', '20'].map((r) => (
                        <option key={r} value={r}>{r} %</option>
                      ))}
                      {form.taxRate !== '' && !['0', '2.1', '5.5', '10', '20'].includes(String(form.taxRate)) && (
                        <option value={String(form.taxRate)}>{form.taxRate} %</option>
                      )}
                    </select>
                  </div>
                </div>
                {(() => {
                  const ttc = parseFloat(form.price);
                  const rate = parseFloat(form.taxRate);
                  if (!Number.isFinite(ttc) || ttc <= 0 || !Number.isFinite(rate)) return null;
                  const ht = ttc / (1 + rate / 100);
                  const tva = ttc - ht;
                  return (
                    <p className="text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                      HT <strong>{ht.toFixed(2)} €</strong> · TVA <strong>{tva.toFixed(2)} €</strong> · TTC <strong>{ttc.toFixed(2)} €</strong>
                    </p>
                  );
                })()}
              </section>

              {/* ── Achat & stock ── */}
              <section className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Achat &amp; stock</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Prix d'achat (EUR)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                      placeholder="12.50"
                      value={form.cost}
                      onChange={(e) => setForm({ ...form, cost: e.target.value })}
                    />
                    <p className="mt-1 text-[11px] text-gray-400">Nécessaire au calcul de la marge.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Stock</label>
                    <input
                      type="number"
                      min="0"
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                      placeholder="50"
                      value={form.stock}
                      onChange={(e) => setForm({ ...form, stock: e.target.value })}
                    />
                  </div>
                </div>
                {(() => {
                  const ttc = parseFloat(form.price);
                  const cost = parseFloat(form.cost);
                  if (!Number.isFinite(ttc) || !Number.isFinite(cost) || cost <= 0) return null;
                  const margin = ttc - cost;
                  const pct = ttc > 0 ? (margin / ttc) * 100 : 0;
                  const negative = margin < 0;
                  return (
                    <p className={`text-[11px] rounded-lg px-3 py-2 ${negative ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-500'}`}>
                      Marge <strong>{margin.toFixed(2)} €</strong> ({pct.toFixed(1)} %)
                      {negative && ' — prix de vente inférieur au prix d\'achat'}
                    </p>
                  );
                })()}
              </section>

              {/* ── Description ── */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Description</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent resize-none"
                  placeholder="Description courte (optionnelle)"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              {formError && (
                <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                  <XCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Pack / produit composé (GO owner 2026-07-09) — édition seulement :
                  le produit doit exister pour porter une composition. */}
              {editingId && <PackComponentsSection productId={editingId} storeId={storeId} />}
            </div>

            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
              {/* Price change confirmation */}
              {priceConfirm && originalPrice !== null && (
                <div className="flex-1 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-xs">
                  <p className="font-bold text-amber-800 mb-1">⚠️ Modification de prix détectée</p>
                  <p className="text-amber-700">
                    Ancien : <strong>{originalPrice.toFixed(2)} €</strong> → Nouveau : <strong>{parseFloat(form.price || '0').toFixed(2)} €</strong>
                    {' '}({((parseFloat(form.price || '0') - originalPrice) / originalPrice * 100).toFixed(1)}%)
                  </p>
                  <p className="text-amber-600 mt-1">Cliquez à nouveau sur "Enregistrer" pour confirmer.</p>
                </div>
              )}
              <button
                onClick={() => { setShowModal(false); setPriceConfirm(false); setOriginalPrice(null); resetForm(); }}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim() || saving}
                className={`px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-colors shadow-lg disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 ${
                  priceConfirm ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/25' : 'bg-bo-accent hover:bg-bo-accent/90 shadow-bo-accent/25'
                }`}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {priceConfirm ? 'Confirmer le changement de prix' : editingId ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Rapport d'import CSV (PR #29) — honnête, ligne par ligne ═══ */}
      {importError && (
        <div className="fixed bottom-6 right-6 z-50 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm shadow-lg flex items-center gap-3">
          <XCircle size={16} />
          {importError}
          <button onClick={() => setImportError(null)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
        </div>
      )}
      {importReport && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-bo-text">Rapport d'import catalogue</h3>
              <button onClick={() => setImportReport(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-4 gap-3 px-6 py-4">
              <div className="rounded-xl bg-gray-50 p-3 text-center">
                <p className="text-2xl font-black text-bo-text">{importReport.total}</p>
                <p className="text-xs text-gray-500">Lignes lues</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3 text-center">
                <p className="text-2xl font-black text-emerald-600">{importReport.created}</p>
                <p className="text-xs text-emerald-600">Créés</p>
              </div>
              <div className="rounded-xl bg-indigo-50 p-3 text-center">
                <p className="text-2xl font-black text-indigo-600">{importReport.updated}</p>
                <p className="text-xs text-indigo-600">Mis à jour</p>
              </div>
              <div className={`rounded-xl p-3 text-center ${importReport.skipped > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                <p className={`text-2xl font-black ${importReport.skipped > 0 ? 'text-red-600' : 'text-gray-400'}`}>{importReport.skipped}</p>
                <p className={`text-xs ${importReport.skipped > 0 ? 'text-red-600' : 'text-gray-500'}`}>Ignorés (erreur)</p>
              </div>
            </div>
            {importReport.errors.length > 0 && (
              <div className="px-6 pb-4 overflow-y-auto">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Lignes en erreur — aucune n'a été importée silencieusement</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="py-1.5 pr-3">Ligne</th>
                      <th className="py-1.5 pr-3">EAN</th>
                      <th className="py-1.5">Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importReport.errors.map((e) => (
                      <tr key={`imp-err-${e.line}`} className="border-b border-gray-50">
                        <td className="py-1.5 pr-3 font-mono text-gray-500">{e.line}</td>
                        <td className="py-1.5 pr-3 font-mono">{e.ean || '—'}</td>
                        <td className="py-1.5 text-red-600">{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-6 py-4 border-t border-gray-100 text-right">
              <button
                onClick={() => setImportReport(null)}
                className="px-5 py-2.5 rounded-xl text-sm font-medium bg-bo-accent text-white hover:bg-bo-accent/90"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Message serveur affiché VERBATIM (BadRequest anti-boucle, conflit, etc.). */
function serverMsg(e: any): string {
  const m = e?.response?.data?.message;
  return typeof m === 'string' ? m : Array.isArray(m) ? m.join(', ') : 'Erreur serveur';
}

/**
 * Pack / produit composé (GO owner 2026-07-09).
 * Le produit ÉDITÉ est le parent (facturé, une seule ligne ticket) ; chaque
 * composant listé ici sort du stock automatiquement à la vente. La composition
 * est modifiable librement : les ventes passées gardent leur snapshot.
 */
function PackComponentsSection({ productId, storeId }: { productId: string; storeId?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await productsApi.listComponents(productId);
      const data = Array.isArray(res.data) ? res.data : [];
      setRows(data);
      if (data.length > 0) setOpen(true);
      setError(null);
    } catch (e: any) {
      setError(serverMsg(e));
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  // Recherche serveur (mêmes params que la liste produits), débouncée.
  useEffect(() => {
    if (!adding) return;
    const t = setTimeout(async () => {
      try {
        const res = await productsApi.list({ storeId, search: query.trim() || undefined, limit: 8 });
        const data: any[] = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.products || []);
        setResults(data.filter((p) => p.id !== productId));
      } catch {
        /* recherche silencieuse — l'erreur bloquante viendra de l'ajout */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [adding, query, storeId, productId]);

  const addComponent = async () => {
    if (!selected) return;
    const q = parseInt(qty, 10);
    if (!Number.isInteger(q) || q <= 0) { setError('La quantité doit être un entier strictement positif.'); return; }
    try {
      setBusy(true);
      await productsApi.addComponent(productId, { componentProductId: selected.id, quantityPerParent: q });
      setSelected(null); setQuery(''); setQty('1'); setAdding(false); setError(null);
      await load();
    } catch (e: any) {
      setError(serverMsg(e)); // anti-boucle / doublon affichés tels quels
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row: any) => {
    try {
      setBusy(true);
      await productsApi.updateComponent(productId, row.id, { isActive: !row.isActive });
      setError(null);
      await load();
    } catch (e: any) { setError(serverMsg(e)); } finally { setBusy(false); }
  };

  const saveQty = async (row: any, value: string) => {
    const q = parseInt(value, 10);
    if (!Number.isInteger(q) || q <= 0 || q === row.quantityPerParent) return;
    try {
      setBusy(true);
      await productsApi.updateComponent(productId, row.id, { quantityPerParent: q });
      setError(null);
      await load();
    } catch (e: any) { setError(serverMsg(e)); } finally { setBusy(false); }
  };

  const remove = async (row: any) => {
    if (!confirm(`Retirer « ${row.componentName ?? row.componentProductId} » de la composition ?\n(Les ventes passées gardent leur composition d'origine.)`)) return;
    try {
      setBusy(true);
      await productsApi.removeComponent(productId, row.id);
      setError(null);
      await load();
    } catch (e: any) { setError(serverMsg(e)); } finally { setBusy(false); }
  };

  const hasComponents = rows.length > 0;

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-bo-text">Pack / produit composé</p>
          <p className="text-xs text-gray-400">Ce produit contient d'autres produits (inclus dans son prix)</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          disabled={hasComponents}
          title={hasComponents ? 'Composition existante — retirez les composants pour masquer' : ''}
          className={`relative w-11 h-6 rounded-full transition-colors ${open ? 'bg-bo-accent' : 'bg-gray-200'} ${hasComponents ? 'opacity-70' : ''}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${open ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
              <XCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <p className="text-xs text-gray-400 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Chargement de la composition…</p>
          ) : hasComponents ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 text-left">
                  <th className="py-1 font-medium">Composant</th>
                  <th className="py-1 font-medium w-20">Qté / unité</th>
                  <th className="py-1 font-medium w-16">Statut</th>
                  <th className="py-1 w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100">
                    <td className="py-2 pr-2">
                      <p className={`font-medium ${row.isActive ? 'text-bo-text' : 'text-gray-400 line-through'}`}>{row.componentName ?? '(produit supprimé)'}</p>
                      <p className="text-gray-400 font-mono">{row.componentEan}</p>
                    </td>
                    <td className="py-2">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        defaultValue={row.quantityPerParent}
                        onBlur={(e) => saveQty(row, e.target.value)}
                        disabled={busy}
                        className="w-16 px-2 py-1 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                      />
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => toggleActive(row)}
                        disabled={busy}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium ${row.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}
                      >
                        {row.isActive ? 'Actif' : 'Inactif'}
                      </button>
                    </td>
                    <td className="py-2 text-right">
                      <button type="button" onClick={() => remove(row)} disabled={busy} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-gray-400">Aucun composant — ce produit se vend seul pour l'instant.</p>
          )}

          {adding ? (
            <div className="rounded-xl bg-gray-50 p-3 space-y-2">
              <input
                type="text"
                autoFocus
                placeholder="Rechercher un produit existant (nom ou EAN)…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
              />
              {!selected && results.length > 0 && (
                <ul className="max-h-36 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                  {results.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => { setSelected(p); setQuery(p.name); }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
                      >
                        <span className="font-medium text-bo-text">{p.name}</span>
                        <span className="ml-2 text-gray-400 font-mono">{p.ean}</span>
                        <span className="ml-2 text-gray-400">stock {p.stockQuantity ?? 0}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Quantité consommée par unité vendue :</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-16 px-2 py-1 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                />
                <div className="flex-1" />
                <button type="button" onClick={() => { setAdding(false); setSelected(null); setQuery(''); }} className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100">
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={addComponent}
                  disabled={!selected || busy}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-bo-accent disabled:opacity-40 flex items-center gap-1.5"
                >
                  {busy && <Loader2 size={11} className="animate-spin" />}
                  Ajouter au pack
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setAdding(true); setResults([]); setQuery(''); }}
              className="flex items-center gap-1.5 text-xs font-medium text-bo-accent hover:underline"
            >
              <Plus size={13} /> Ajouter un composant
            </button>
          )}
        </div>
      )}
    </div>
  );
}
