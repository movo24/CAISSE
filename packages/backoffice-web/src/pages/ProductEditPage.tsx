import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ScanBarcode, Save, ArrowLeft, Loader2, Package, Euro, Boxes, Truck,
  Layers, GitBranch, Image as ImageIcon, Ruler, BadgePercent, BarChart3,
  History, Plus, Trash2, AlertCircle, CheckCircle2, Pencil, Link2,
} from 'lucide-react';
import { productsApi } from '../services/api';
import { ttcFromHt, eurosInputToMinor, minorToEurosInput, parseTaxRate } from './pricingMath';
import { suggestShortName, shouldAutoFillShortName } from '../utils/shortName';
import { prepareProductImage } from '../utils/imageFile';
import {
  validateFiche, mapApiError, firstErrorField, errorSummary,
  tabOfField, labelOfField, type FicheErrors, type FicheFormShape,
} from '../utils/ficheValidation';
import { gtinIssue, GTIN_ISSUE_MESSAGE } from '../utils/gtin';

/**
 * Fiche produit PROFESSIONNELLE (page complète — remplace la popup minimaliste).
 *
 * Phase 1 (AUCUNE migration) : uniquement des données RÉELLES —
 *  - colonnes produits existantes (nom, description, catégorie, marque,
 *    fournisseur, SKU, EAN, prix vente TTC, prix d'achat, TVA, stock + seuils,
 *    image, unité, actif) ;
 *  - fonctionnalités existantes intégrées : packs (product_components),
 *    variantes, prix magasin programmé (fenêtre = promotion), historique des
 *    prix, analytics produit.
 * Les champs SANS colonne en base (logistique poids/dimensions, prix
 * min/conseillé, multi-photos, fidélité…) sont listés dans l'onglet concerné
 * comme Phase 2 — migration `products` = Tier-2, GO owner requis. Rien n'est
 * simulé.
 *
 * Flux « scanner d'abord » : en création, le curseur est sur l'EAN ; un scan
 * vérifie l'existence (products/scan/:ean) → édite l'existant ou crée.
 */

type Tab =
  | 'general' | 'tarification' | 'stock' | 'fournisseurs' | 'packs'
  | 'variantes' | 'lies' | 'images' | 'logistique' | 'promotions' | 'stats' | 'historique';

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'general', label: 'Général', icon: Package },
  { key: 'tarification', label: 'Tarification', icon: Euro },
  { key: 'stock', label: 'Stock', icon: Boxes },
  { key: 'fournisseurs', label: 'Fournisseurs', icon: Truck },
  { key: 'packs', label: 'Packs', icon: Layers },
  { key: 'variantes', label: 'Variantes', icon: GitBranch },
  { key: 'lies', label: 'Produits liés', icon: Link2 },
  { key: 'images', label: 'Images', icon: ImageIcon },
  { key: 'logistique', label: 'Logistique', icon: Ruler },
  { key: 'promotions', label: 'Promotions', icon: BadgePercent },
  { key: 'stats', label: 'Statistiques', icon: BarChart3 },
  { key: 'historique', label: 'Historique', icon: History },
];

const LINK_LABEL: Record<string, string> = {
  complementary: 'Complémentaire',
  cross_sell: 'Vente croisée',
  substitute: 'Substitution',
};

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const eur = (m: number | null | undefined) =>
  m == null ? '—' : (m / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const toMinor = (s: string) => {
  const v = parseFloat((s || '').replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
};
/** Entier positif ou undefined (jamais de clé vide envoyée). */
const toInt = (s: string): number | undefined => {
  const n = parseInt((s || '').trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bo-accent/20 focus:border-bo-accent/50';
const labelCls = 'block text-xs font-semibold text-gray-500 mb-1.5';

function Field({ label, children, hint, error, fieldId }: {
  label: string; children: React.ReactNode; hint?: string;
  /** Message d'erreur de validation — surligne le champ et s'affiche dessous. */
  error?: string | null; fieldId?: string;
}) {
  return (
    <div id={fieldId} className={error ? 'fp-field-error' : undefined}>
      <label className={`${labelCls}${error ? ' !text-red-600' : ''}`}>{label}</label>
      {children}
      {error
        ? <p className="text-[11px] text-red-600 font-medium mt-1" role="alert">{error}</p>
        : hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

/** Champs Phase 2 — jamais simulés (migration produits = GO owner). */
function Phase2Notice({ fields }: { fields: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-xs text-amber-800">
      <p className="font-semibold mb-0.5">Phase 2 — champs non encore persistés en base</p>
      <p>{fields}</p>
      <p className="mt-1 text-amber-600">Nécessite une migration de la table produits (validation owner). Aucune donnée fictive n'est affichée.</p>
    </div>
  );
}

export function ProductEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const duplicateFrom = searchParams.get('from'); // /products/new?from=<id> → duplication
  const isEdit = Boolean(id);

  // ── Porte « scanner d'abord » (création). En duplication, on passe la porte
  //    (les champs sont pré-remplis depuis la source) mais l'EAN reste à saisir. ──
  const [gate, setGate] = useState(!isEdit && !duplicateFrom);
  const [gateEan, setGateEan] = useState('');
  const [gateBusy, setGateBusy] = useState(false);
  const [gateExisting, setGateExisting] = useState<any | null>(null);
  const gateRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (gate) gateRef.current?.focus(); }, [gate]);

  // ── Données ──
  const [loading, setLoading] = useState(isEdit);
  const [tab, setTab] = useState<Tab>('general');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    ean: '', name: '', description: '', categoryId: '', unitType: 'unit',
    sku: '', brandId: '', supplierId: '', priceTtc: '', cost: '', taxRate: '20',
    stock: '0', alertThreshold: '10', criticalThreshold: '5', imageUrl: '', status: 'active',
    // Lot 2 — champs additifs
    shortName: '', internalRef: '', supplierRef: '', productType: 'simple', countryOfOrigin: '',
    leadTimeDays: '', minOrderQuantity: '', weightGrams: '', widthMm: '', heightMm: '', depthMm: '',
    volumeMl: '', unitsPerCarton: '',
    // Lot E — saisonnalité
    isSeasonal: false, seasonStartMonth: '', seasonEndMonth: '',
    // Lot I — prix encadrés, conditionnement, réglementaire
    minPrice: '', recommendedPrice: '', unitsPerPack: '', cartonsPerPallet: '',
    allergens: '', ingredients: '', bestBeforeDate: '', useByDate: '', lotNumber: '',
  });
  // Erreurs de validation par champ (client + serveur mappé) — la correction
  // d'un champ efface son erreur immédiatement.
  const [fieldErrors, setFieldErrors] = useState<FicheErrors>({});
  const set = (k: keyof typeof form, v: any) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((fe) => {
      if (!(k in fe)) return fe;
      const next = { ...fe };
      delete next[k as keyof FicheErrors];
      return next;
    });
  };

  /** Ouvre l'onglet du champ fautif, le fait défiler à l'écran et lui donne le focus. */
  const goToField = (key: keyof FicheErrors) => {
    setTab(tabOfField(key) as Tab);
    // L'onglet doit être rendu avant de pouvoir focus le champ.
    window.setTimeout(() => {
      const wrapper = document.getElementById(`fp-${key}`);
      const input = wrapper?.querySelector<HTMLElement>('input, select, textarea');
      wrapper?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input?.focus();
    }, 50);
  };

  /** Props d'erreur d'un champ : `<Field {...fp('ean')}>`. */
  const fp = (k: keyof FicheErrors) => ({ error: fieldErrors[k], fieldId: `fp-${k}` });

  const [original, setOriginal] = useState<any | null>(null);
  const [brands, setBrands] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; parentId: string | null }>>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [storePrice, setStorePrice] = useState<any | null>(null);
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  // Saisie HT en cours (tarification bidirectionnelle — repris de la fiche P1 #84) :
  // tant que l'utilisateur édite le HT, il reste maître et le TTC est recalculé.
  const [htInput, setHtInput] = useState<string | null>(null);
  // Nom court auto-proposé depuis le nom (jamais d'écrasement d'une saisie manuelle).
  const lastShortSuggestion = useRef('');
  // Création rapide de catégorie depuis la fiche (même principe que la marque,
  // avec choix du parent pour respecter l'arborescence).
  const [showCatForm, setShowCatForm] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatParent, setNewCatParent] = useState('');
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);
  // Photo principale : sélection + compression + erreurs explicites.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  // Lot 4 — galerie & documents
  const [media, setMedia] = useState<any[]>([]);
  const [dragMediaIdx, setDragMediaIdx] = useState<number | null>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [newMediaUrl, setNewMediaUrl] = useState('');
  const [newDocName, setNewDocName] = useState('');
  const [newDocUrl, setNewDocUrl] = useState('');
  // Lot A — codes-barres multiples
  const [barcodes, setBarcodes] = useState<any[]>([]);
  const [newBarcode, setNewBarcode] = useState('');
  const [newBarcodeType, setNewBarcodeType] = useState('ean');
  // Lot B — fournisseurs multiples
  const [prodSuppliers, setProdSuppliers] = useState<any[]>([]);
  const [psForm, setPsForm] = useState({ supplierId: '', supplierRef: '', purchasePrice: '', currencyCode: 'EUR', leadTimeDays: '', minOrderQuantity: '', incoterm: '', isPrimary: false });
  // Lot D — journal des modifications
  const [changeLog, setChangeLog] = useState<any[]>([]);
  // Lot E — produits liés
  const [links, setLinks] = useState<any[]>([]);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState<any[]>([]);
  const [linkType, setLinkType] = useState('complementary');

  const load = useCallback(async () => {
    try {
      const [b, s, c] = await Promise.all([
        productsApi.listBrands(),
        productsApi.listSuppliers(),
        productsApi.listCategories(),
      ]);
      setBrands(b.data || []); setSuppliers(s.data || []);
      setCategories((c.data || []).map((x: any) => ({ id: x.id, name: x.name, parentId: x.parentId ?? null })));
      if (!id) {
        if (duplicateFrom) {
          try {
            const src = (await productsApi.get(duplicateFrom)).data;
            // Duplication : on reprend tout SAUF les identifiants uniques (EAN, SKU)
            // et le stock ; statut brouillon pour forcer une revue avant activation.
            setForm((f) => ({
              ...f,
              ean: '',
              name: src.name ? `${src.name} (copie)` : '',
              description: src.description || '',
              categoryId: src.categoryId || '',
              unitType: src.unitType || 'unit',
              sku: '',
              brandId: src.brandId || '',
              supplierId: src.supplierId || '',
              priceTtc: src.priceMinorUnits != null ? (src.priceMinorUnits / 100).toFixed(2) : '',
              cost: src.costMinorUnits != null ? (src.costMinorUnits / 100).toFixed(2) : '',
              taxRate: String(src.taxRate ?? 20),
              stock: '0',
              alertThreshold: String(src.stockAlertThreshold ?? 10),
              criticalThreshold: String(src.stockCriticalThreshold ?? 5),
              imageUrl: src.imageUrl || '',
              status: 'draft',
              shortName: src.shortName || '', internalRef: '', supplierRef: src.supplierRef || '',
              productType: src.productType || 'simple', countryOfOrigin: src.countryOfOrigin || '',
              leadTimeDays: src.leadTimeDays != null ? String(src.leadTimeDays) : '',
              minOrderQuantity: src.minOrderQuantity != null ? String(src.minOrderQuantity) : '',
              weightGrams: src.weightGrams != null ? String(src.weightGrams) : '',
              widthMm: src.widthMm != null ? String(src.widthMm) : '',
              heightMm: src.heightMm != null ? String(src.heightMm) : '',
              depthMm: src.depthMm != null ? String(src.depthMm) : '',
              volumeMl: src.volumeMl != null ? String(src.volumeMl) : '',
              unitsPerCarton: src.unitsPerCarton != null ? String(src.unitsPerCarton) : '',
            }));
          } catch { /* source introuvable → création vierge */ }
        }
        setLoading(false); return;
      }
      const p = (await productsApi.get(id)).data;
      setOriginal(p);
      setHtInput(null);
      setForm({
        ean: p.ean || '', name: p.name || '', description: p.description || '',
        categoryId: p.categoryId || '', unitType: p.unitType || 'unit',
        sku: p.sku || '', brandId: p.brandId || '', supplierId: p.supplierId || '',
        priceTtc: p.priceMinorUnits != null ? (p.priceMinorUnits / 100).toFixed(2) : '',
        cost: p.costMinorUnits != null ? (p.costMinorUnits / 100).toFixed(2) : '',
        taxRate: String(p.taxRate ?? 20), stock: String(p.stockQuantity ?? 0),
        alertThreshold: String(p.stockAlertThreshold ?? 10),
        criticalThreshold: String(p.stockCriticalThreshold ?? 5),
        imageUrl: p.imageUrl || '', status: p.status || 'active',
        shortName: p.shortName || '', internalRef: p.internalRef || '', supplierRef: p.supplierRef || '',
        productType: p.productType || 'simple', countryOfOrigin: p.countryOfOrigin || '',
        leadTimeDays: p.leadTimeDays != null ? String(p.leadTimeDays) : '',
        minOrderQuantity: p.minOrderQuantity != null ? String(p.minOrderQuantity) : '',
        weightGrams: p.weightGrams != null ? String(p.weightGrams) : '',
        widthMm: p.widthMm != null ? String(p.widthMm) : '',
        heightMm: p.heightMm != null ? String(p.heightMm) : '',
        depthMm: p.depthMm != null ? String(p.depthMm) : '',
        volumeMl: p.volumeMl != null ? String(p.volumeMl) : '',
        unitsPerCarton: p.unitsPerCarton != null ? String(p.unitsPerCarton) : '',
        isSeasonal: p.isSeasonal === true,
        seasonStartMonth: p.seasonStartMonth != null ? String(p.seasonStartMonth) : '',
        seasonEndMonth: p.seasonEndMonth != null ? String(p.seasonEndMonth) : '',
        minPrice: p.minPriceMinorUnits != null ? (p.minPriceMinorUnits / 100).toFixed(2) : '',
        recommendedPrice: p.recommendedPriceMinorUnits != null ? (p.recommendedPriceMinorUnits / 100).toFixed(2) : '',
        unitsPerPack: p.unitsPerPack != null ? String(p.unitsPerPack) : '',
        cartonsPerPallet: p.cartonsPerPallet != null ? String(p.cartonsPerPallet) : '',
        allergens: p.allergens || '', ingredients: p.ingredients || '',
        bestBeforeDate: p.bestBeforeDate ? String(p.bestBeforeDate).slice(0, 10) : '',
        useByDate: p.useByDate ? String(p.useByDate).slice(0, 10) : '',
        lotNumber: p.lotNumber || '',
      });
      // Ancienne fiche sans nom court : proposer depuis le nom (reste modifiable).
      // Un nom court déjà saisi n'est JAMAIS écrasé (lastShortSuggestion vide).
      if (!p.shortName && p.name) {
        const brandName = (b.data || []).find((x: any) => x.id === p.brandId)?.name ?? null;
        const s0 = suggestShortName(p.name, brandName);
        lastShortSuggestion.current = s0;
        setForm((f) => ({ ...f, shortName: s0 }));
      } else {
        lastShortSuggestion.current = '';
      }
      // Chargements non bloquants des onglets (endpoints existants)
      productsApi.listComponents(id).then((r) => setComponents(r.data || [])).catch(() => {});
      productsApi.listVariants(id).then((r) => setVariants(r.data || [])).catch(() => {});
      productsApi.getStorePrice(id).then((r) => setStorePrice(r.data || null)).catch(() => setStorePrice(null));
      productsApi.priceHistory(id).then((r) => setPriceHistory(r.data || [])).catch(() => {});
      productsApi.priceAnalytics(id).then((r) => setAnalytics(r.data || null)).catch(() => {});
      productsApi.listMedia(id).then((r) => setMedia(r.data || [])).catch(() => {});
      productsApi.listDocuments(id).then((r) => setDocuments(r.data || [])).catch(() => {});
      productsApi.listBarcodes(id).then((r) => setBarcodes(r.data || [])).catch(() => {});
      productsApi.listProductSuppliers(id).then((r) => setProdSuppliers(r.data || [])).catch(() => {});
      productsApi.changeLog(id).then((r) => setChangeLog(r.data || [])).catch(() => {});
      productsApi.listLinks(id).then((r) => setLinks(r.data || [])).catch(() => {});
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Chargement impossible');
    } finally { setLoading(false); }
  }, [id, duplicateFrom]);
  useEffect(() => { load(); }, [load]);

  // ── Scanner d'abord : vérifie l'existence de l'EAN ──
  const checkEan = async () => {
    const ean = gateEan.trim();
    if (!ean) return;
    setGateBusy(true); setGateExisting(null);
    try {
      const r = await productsApi.scan(ean);
      if (r.data?.id) { setGateExisting(r.data); return; }
      set('ean', ean); setGate(false);
    } catch {
      // introuvable → nouvelle fiche avec cet EAN
      set('ean', ean); setGate(false);
    } finally { setGateBusy(false); }
  };

  // ── Tarification dérivée (marge automatique) ──
  const calc = useMemo(() => {
    const ttc = toMinor(form.priceTtc); const cost = toMinor(form.cost);
    const tva = parseFloat(form.taxRate.replace(',', '.')) || 0;
    const ht = ttc != null ? Math.round(ttc / (1 + tva / 100)) : null;
    const costTtc = cost != null ? Math.round(cost * (1 + tva / 100)) : null;
    const margeM = ht != null && cost != null ? ht - cost : null;
    const tauxMarge = margeM != null && cost ? (margeM / cost) * 100 : null;   // sur PA
    const tauxMarque = margeM != null && ht ? (margeM / ht) * 100 : null;      // sur PV HT
    return { ttc, ht, cost, costTtc, margeM, tauxMarge, tauxMarque };
  }, [form.priceTtc, form.cost, form.taxRate]);

  // ── Options catégories (arbre hiérarchique aplati, indenté) ──
  const catOptions = useMemo(() => {
    const byParent = new Map<string | null, typeof categories>();
    for (const c of categories) {
      const k = c.parentId ?? null;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(c);
    }
    for (const l of byParent.values()) l.sort((a, b) => a.name.localeCompare(b.name));
    const out: Array<{ id: string; label: string }> = [];
    const walk = (pid: string | null, depth: number) => {
      for (const c of byParent.get(pid) ?? []) {
        out.push({ id: c.id, label: `${'  '.repeat(depth)}${c.name}` });
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [categories]);

  // ── Sauvegarde ──
  const save = async () => {
    setError(null); setSaved(false);
    // Validation client complète : chaque problème est rattaché à SON champ,
    // l'onglet fautif s'ouvre et le premier champ invalide prend le focus.
    const clientErrors = validateFiche(form as FicheFormShape, isEdit);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setError(errorSummary(clientErrors));
      goToField(firstErrorField(clientErrors)!);
      return;
    }
    setFieldErrors({});
    const ttc = toMinor(form.priceTtc)!; // garanti par validateFiche
    const common = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      categoryId: form.categoryId.trim() || undefined,
      unitType: form.unitType || undefined,
      priceMinorUnits: ttc,
      costMinorUnits: toMinor(form.cost) ?? undefined,
      // `|| undefined` écrasait les valeurs 0 (TVA 0 %, seuil 0) qui retombaient
      // silencieusement sur les défauts serveur (20 %, 10) — 0 est une valeur valide.
      taxRate: (() => { const t = parseFloat(form.taxRate.replace(',', '.')); return Number.isFinite(t) && t >= 0 ? t : undefined; })(),
      stockQuantity: toInt(form.stock) ?? 0,
      stockAlertThreshold: toInt(form.alertThreshold),
      stockCriticalThreshold: toInt(form.criticalThreshold),
      imageUrl: form.imageUrl.trim() || undefined,
      brandId: form.brandId || undefined,
      supplierId: form.supplierId || undefined,
      sku: form.sku.trim() || undefined,
      status: form.status || undefined,
      // Lot 2 — champs additifs
      shortName: form.shortName.trim() || undefined,
      internalRef: form.internalRef.trim() || undefined,
      supplierRef: form.supplierRef.trim() || undefined,
      productType: form.productType || undefined,
      countryOfOrigin: form.countryOfOrigin.trim() || undefined,
      leadTimeDays: toInt(form.leadTimeDays),
      minOrderQuantity: toInt(form.minOrderQuantity),
      weightGrams: toInt(form.weightGrams),
      widthMm: toInt(form.widthMm),
      heightMm: toInt(form.heightMm),
      depthMm: toInt(form.depthMm),
      volumeMl: toInt(form.volumeMl),
      unitsPerCarton: toInt(form.unitsPerCarton),
      isSeasonal: form.isSeasonal,
      seasonStartMonth: form.isSeasonal ? toInt(form.seasonStartMonth) : undefined,
      seasonEndMonth: form.isSeasonal ? toInt(form.seasonEndMonth) : undefined,
      // Lot I
      minPriceMinorUnits: toMinor(form.minPrice) ?? undefined,
      recommendedPriceMinorUnits: toMinor(form.recommendedPrice) ?? undefined,
      unitsPerPack: toInt(form.unitsPerPack),
      cartonsPerPallet: toInt(form.cartonsPerPallet),
      allergens: form.allergens.trim() || undefined,
      ingredients: form.ingredients.trim() || undefined,
      bestBeforeDate: form.bestBeforeDate || undefined,
      useByDate: form.useByDate || undefined,
      lotNumber: form.lotNumber.trim() || undefined,
    };
    setSaving(true);
    try {
      if (isEdit && id) {
        const priceChanged = original && ttc !== original.priceMinorUnits;
        await productsApi.update(id, {
          ...common,
          reason: priceChanged ? (reason.trim() || 'Fiche produit — modification prix') : undefined,
        } as any);
        setSaved(true); load();
      } else {
        const r = await productsApi.create({ ...common, ean: form.ean.trim() } as any);
        navigate(`/products/${r.data.id}/edit`, { replace: true });
      }
    } catch (e: any) {
      // Mappe la réponse serveur (400/409/…) vers les champs du formulaire :
      // jamais un « Erreur de validation » générique, saisies toujours conservées.
      const mapped = mapApiError(e?.response?.data);
      setFieldErrors(mapped.fieldErrors);
      const n = Object.keys(mapped.fieldErrors).length;
      setError(
        [n > 0 ? errorSummary(mapped.fieldErrors) : null, mapped.banner]
          .filter(Boolean).join(' ') || 'Enregistrement impossible',
      );
      const first = firstErrorField(mapped.fieldErrors);
      if (first) goToField(first);
    } finally { setSaving(false); }
  };

  const createBrand = async () => {
    const name = window.prompt('Nom de la nouvelle marque :')?.trim();
    if (!name) return;
    const r = await productsApi.createBrand(name).catch(() => null);
    if (r?.data) {
      // Le serveur dédoublonne (get-or-create) : ne pas ré-ajouter une marque déjà listée.
      setBrands((b) => (b.some((x) => x.id === r.data.id) ? b : [...b, r.data]));
      applyBrandChange(r.data.id, r.data.name);
    }
  };

  // ── Nom court (caisse) auto-proposé — jamais d'écrasement d'une saisie manuelle ──
  // NB : la décision (et la mutation de lastShortSuggestion) reste HORS de
  // l'updater setForm — un updater doit être pur (StrictMode l'invoque deux
  // fois : un effet de bord dedans annulait la re-suggestion).
  const applyNameChange = (value: string) => {
    const brandName = brands.find((b) => b.id === form.brandId)?.name ?? null;
    const suggestion = suggestShortName(value, brandName);
    const auto = shouldAutoFillShortName(form.shortName, lastShortSuggestion.current);
    setForm((f) => ({ ...f, name: value, ...(auto ? { shortName: suggestion } : {}) }));
    if (auto) lastShortSuggestion.current = suggestion;
  };
  const applyBrandChange = (brandId: string, knownName?: string) => {
    const brandName = knownName ?? brands.find((b) => b.id === brandId)?.name ?? null;
    const suggestion = suggestShortName(form.name, brandName);
    const auto = shouldAutoFillShortName(form.shortName, lastShortSuggestion.current);
    setForm((f) => ({ ...f, brandId, ...(auto ? { shortName: suggestion } : {}) }));
    if (auto) lastShortSuggestion.current = suggestion;
  };

  // ── Création rapide de catégorie (avec parent — arborescence respectée) ──
  const createCategoryInline = async () => {
    const name = newCatName.trim();
    if (!name) { setCatError('Le nom de la catégorie est obligatoire.'); return; }
    setCatBusy(true); setCatError(null);
    try {
      const r = await productsApi.createCategory({ name, parentId: newCatParent || null });
      const created = r.data;
      // Le serveur déduplique (même nom sous le même parent → renvoie l'existante).
      const list = (await productsApi.listCategories()).data;
      setCategories(Array.isArray(list) ? list : []);
      set('categoryId', created.id);
      setShowCatForm(false); setNewCatName(''); setNewCatParent('');
    } catch (e: any) {
      setCatError(e?.response?.data?.message || 'Création de la catégorie impossible.');
    } finally {
      setCatBusy(false);
    }
  };

  // ── Photo principale : validation + compression avant stockage data-URL ──
  const onPickImage = async (file: File | null | undefined) => {
    if (!file) return;
    setImageBusy(true); setImageError(null);
    const res = await prepareProductImage(file);
    setImageBusy(false);
    if (res.ok) set('imageUrl', res.dataUrl);
    else setImageError(res.error);
  };
  const createSupplier = async () => {
    const name = window.prompt('Nom du nouveau fournisseur :')?.trim();
    if (!name) return;
    const r = await productsApi.createSupplier(name).catch(() => null);
    if (r?.data) {
      setSuppliers((s) => (s.some((x) => x.id === r.data.id) ? s : [...s, r.data]));
      set('supplierId', r.data.id);
    }
  };

  // ── Onglet Packs ──
  const [compEan, setCompEan] = useState(''); const [compQty, setCompQty] = useState('1');
  const addComponent = async () => {
    if (!id) return;
    try {
      const found = (await productsApi.scan(compEan.trim())).data;
      if (!found?.id) throw new Error();
      await productsApi.addComponent(id, { componentProductId: found.id, quantityPerParent: parseInt(compQty, 10) || 1 });
      setCompEan(''); setCompQty('1');
      setComponents((await productsApi.listComponents(id)).data || []);
    } catch (e: any) { setError(e?.response?.data?.message || 'Composant introuvable (scanner son EAN)'); }
  };
  const removeComponent = async (rowId: string) => {
    if (!id) return;
    await productsApi.removeComponent(id, rowId).catch(() => {});
    setComponents((await productsApi.listComponents(id)).data || []);
  };

  // ── Onglet Variantes ──
  const [vName, setVName] = useState(''); const [vEan, setVEan] = useState(''); const [vPrice, setVPrice] = useState('');
  // Lot C — générateur de variantes par attributs
  const [genAttributes, setGenAttributes] = useState<Array<{ name: string; values: string }>>([
    { name: 'Taille', values: '' },
    { name: 'Couleur', values: '' },
  ]);
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const runGenerateVariants = async () => {
    if (!id) return;
    const attributes = genAttributes
      .map((a) => ({ name: a.name.trim(), values: a.values.split(',').map((v) => v.trim()).filter(Boolean) }))
      .filter((a) => a.values.length > 0);
    if (attributes.length === 0) { setError('Renseignez au moins un attribut avec des valeurs (séparées par des virgules).'); return; }
    setGenBusy(true); setGenMsg(null);
    try {
      const r = await productsApi.generateVariants(id, { attributes });
      setGenMsg(`${r.data.created} variante(s) créée(s)${r.data.skipped?.length ? `, ${r.data.skipped.length} déjà existante(s)` : ''}.`);
      setVariants((await productsApi.listVariants(id)).data || []);
    } catch (e: any) { setError(e?.response?.data?.message || 'Génération impossible'); }
    finally { setGenBusy(false); }
  };
  const addVariant = async () => {
    if (!id) return;
    const pm = toMinor(vPrice);
    if (!vName.trim() || !vEan.trim() || pm == null) { setError('Variante : nom, EAN et prix requis.'); return; }
    try {
      await productsApi.createVariant(id, { ean: vEan.trim(), variantName: vName.trim(), priceMinorUnits: pm });
      setVName(''); setVEan(''); setVPrice('');
      setVariants((await productsApi.listVariants(id)).data || []);
    } catch (e: any) { setError(e?.response?.data?.message || 'Création de variante impossible'); }
  };

  // ── Onglet Promotions (prix magasin programmé — mécanisme réel existant) ──
  const [promoPrice, setPromoPrice] = useState(''); const [promoStart, setPromoStart] = useState(''); const [promoEnd, setPromoEnd] = useState('');
  const savePromo = async () => {
    if (!id) return;
    const pm = toMinor(promoPrice);
    if (pm == null) { setError('Prix promotionnel invalide.'); return; }
    try {
      await productsApi.setStorePrice(id, {
        priceMinorUnits: pm,
        startsAt: promoStart ? new Date(promoStart).toISOString() : undefined,
        endsAt: promoEnd ? new Date(promoEnd).toISOString() : undefined,
      });
      setStorePrice((await productsApi.getStorePrice(id)).data || null);
      setPromoPrice(''); setPromoStart(''); setPromoEnd('');
    } catch (e: any) { setError(e?.response?.data?.message || 'Enregistrement promotion impossible'); }
  };
  const clearPromo = async () => {
    if (!id) return;
    await productsApi.clearStorePrice(id).catch(() => {});
    setStorePrice(null);
  };

  // ── Galerie & documents (Lot 4) ──
  const addMedia = async () => {
    if (!id || !newMediaUrl.trim()) return;
    try {
      await productsApi.addMedia(id, newMediaUrl.trim());
      setNewMediaUrl('');
      setMedia((await productsApi.listMedia(id)).data || []);
    } catch (e: any) { setError(e?.response?.data?.message || 'Ajout image impossible'); }
  };
  const removeMedia = async (mid: string) => {
    if (!id) return;
    await productsApi.removeMedia(id, mid).catch(() => {});
    setMedia((await productsApi.listMedia(id)).data || []);
  };
  const moveMedia = async (from: number, to: number) => {
    if (!id || from === to || from == null) return;
    const next = [...media];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setMedia(next); // optimiste
    try { setMedia((await productsApi.reorderMedia(id, next.map((m) => m.id))).data || next); } catch { /* garde l'ordre local */ }
  };
  const addDocument = async () => {
    if (!id || !newDocUrl.trim() || !newDocName.trim()) return;
    try {
      await productsApi.addDocument(id, newDocName.trim(), newDocUrl.trim());
      setNewDocName(''); setNewDocUrl('');
      setDocuments((await productsApi.listDocuments(id)).data || []);
    } catch (e: any) { setError(e?.response?.data?.message || 'Ajout document impossible'); }
  };
  const removeDocument = async (did: string) => {
    if (!id) return;
    await productsApi.removeDocument(id, did).catch(() => {});
    setDocuments((await productsApi.listDocuments(id)).data || []);
  };

  // ── Produits liés (Lot E) ──
  useEffect(() => {
    if (!id) return;
    const t = setTimeout(async () => {
      try {
        const res = await productsApi.list({ search: linkQuery.trim() || undefined, limit: 8 });
        const data: any[] = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.products || []);
        setLinkResults(data.filter((p) => p.id !== id && !links.some((l) => l.linkedProductId === p.id)));
      } catch { /* recherche silencieuse */ }
    }, 250);
    return () => clearTimeout(t);
  }, [linkQuery, id, links]);
  const addLink = async (linkedProductId: string) => {
    if (!id) return;
    try {
      await productsApi.addLink(id, { linkedProductId, linkType });
      setLinkQuery('');
      setLinks((await productsApi.listLinks(id)).data || []);
    } catch (e: any) { setError(e?.response?.data?.message || 'Lien impossible'); }
  };
  const removeLink = async (linkId: string) => {
    if (!id) return;
    await productsApi.removeLink(id, linkId).catch(() => {});
    setLinks((await productsApi.listLinks(id)).data || []);
  };

  // ── Codes-barres multiples (Lot A) ──
  const addBarcode = async () => {
    if (!id || !newBarcode.trim()) return;
    try {
      await productsApi.addBarcode(id, { barcode: newBarcode.trim(), type: newBarcodeType });
      setNewBarcode('');
      setBarcodes((await productsApi.listBarcodes(id)).data || []);
    } catch (e: any) { setError(e?.response?.data?.message || 'Ajout code-barres impossible'); }
  };
  const setPrimaryBarcode = async (bid: string) => {
    if (!id) return;
    await productsApi.setPrimaryBarcode(id, bid).catch(() => {});
    setBarcodes((await productsApi.listBarcodes(id)).data || []);
  };
  const removeBarcode = async (bid: string) => {
    if (!id) return;
    await productsApi.removeBarcode(id, bid).catch(() => {});
    setBarcodes((await productsApi.listBarcodes(id)).data || []);
  };

  // ── Fournisseurs multiples (Lot B) ──
  const addProdSupplier = async () => {
    if (!id || !psForm.supplierId) { setError('Choisissez un fournisseur.'); return; }
    try {
      await productsApi.addProductSupplier(id, {
        supplierId: psForm.supplierId,
        isPrimary: psForm.isPrimary,
        supplierRef: psForm.supplierRef.trim() || undefined,
        purchasePriceMinorUnits: toMinor(psForm.purchasePrice) ?? undefined,
        currencyCode: psForm.currencyCode || 'EUR',
        leadTimeDays: toInt(psForm.leadTimeDays),
        minOrderQuantity: toInt(psForm.minOrderQuantity),
        incoterm: psForm.incoterm.trim() || undefined,
      });
      setPsForm({ supplierId: '', supplierRef: '', purchasePrice: '', currencyCode: 'EUR', leadTimeDays: '', minOrderQuantity: '', incoterm: '', isPrimary: false });
      setProdSuppliers((await productsApi.listProductSuppliers(id)).data || []);
    } catch (e: any) { setError(e?.response?.data?.message || 'Ajout fournisseur impossible'); }
  };
  const setPrimaryProdSupplier = async (rowId: string) => {
    if (!id) return;
    await productsApi.updateProductSupplier(id, rowId, { isPrimary: true }).catch(() => {});
    setProdSuppliers((await productsApi.listProductSuppliers(id)).data || []);
  };
  const removeProdSupplier = async (rowId: string) => {
    if (!id) return;
    await productsApi.removeProductSupplier(id, rowId).catch(() => {});
    setProdSuppliers((await productsApi.listProductSuppliers(id)).data || []);
  };

  // ══════════ PORTE SCANNER (création) ══════════
  if (gate) {
    // Contrôle de format immédiat au scan : un code invalide est signalé ICI,
    // jamais silencieusement au moment de l'enregistrement.
    const gateIssue = gateEan.trim() ? gtinIssue(gateEan) : null;
    return (
      <div className="p-6 lg:p-8 max-w-2xl mx-auto animate-fade-in">
        <button onClick={() => navigate('/products')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6"><ArrowLeft size={15} /> Produits</button>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-soft p-8 text-center space-y-5">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-bo-accent/10 flex items-center justify-center"><ScanBarcode size={26} className="text-bo-accent" /></div>
          <div>
            <h2 className="text-xl font-bold text-bo-text">Nouveau produit</h2>
            <p className="text-sm text-gray-400 mt-1">Scannez le code-barres ou saisissez l'EAN — vérification immédiate de l'existant.</p>
          </div>
          <input
            ref={gateRef} value={gateEan}
            onChange={(e) => { setGateEan(e.target.value); setGateExisting(null); }}
            onKeyDown={(e) => e.key === 'Enter' && checkEan()}
            placeholder="Scanner l'EAN…" className={`${inputCls} text-center text-lg font-mono tracking-wider`}
          />
          {gateIssue && (
            <p className="text-xs font-medium text-red-600 flex items-center justify-center gap-1.5" role="alert">
              <AlertCircle size={13} /> {GTIN_ISSUE_MESSAGE[gateIssue]}
            </p>
          )}
          {gateExisting && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-left">
              <p className="text-sm font-semibold text-amber-800 flex items-center gap-2"><AlertCircle size={15} /> Ce code-barres existe déjà</p>
              <p className="text-sm text-amber-700 mt-1">{gateExisting.name} — {eur(gateExisting.priceMinorUnits)}</p>
              <button onClick={() => navigate(`/products/${gateExisting.id}/edit`)} className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bo-accent text-white text-xs font-semibold"><Pencil size={13} /> Éditer le produit existant</button>
            </div>
          )}
          <div className="flex gap-2 justify-center">
            <button onClick={checkEan} disabled={gateBusy || !gateEan.trim() || !!gateIssue} className="px-5 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-2">
              {gateBusy && <Loader2 size={14} className="animate-spin" />} Vérifier &amp; continuer
            </button>
            <button onClick={() => { set('ean', gateEan.trim()); setGate(false); }} disabled={!gateEan.trim()} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 disabled:opacity-40">Saisie manuelle</button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-gray-300" /></div>;

  const brand = brands.find((b) => b.id === form.brandId);
  const supplier = suppliers.find((s) => s.id === form.supplierId);

  return (
    <div className="p-6 lg:p-8 space-y-5 animate-fade-in max-w-[1200px] mx-auto">
      {/* Header fiche */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/products')} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></button>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-bo-text truncate">{isEdit ? form.name || 'Fiche produit' : 'Nouvelle fiche produit'}</h2>
            <p className="text-xs text-gray-400 font-mono">{form.ean}{form.sku && ` · ${form.sku}`}{brand && ` · ${brand.name}`}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle2 size={14} /> Enregistré</span>}
          <button onClick={save} disabled={saving} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={15} />} Enregistrer
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          <p className="font-semibold flex items-center gap-1.5"><AlertCircle size={15} /> {error}</p>
          {Object.keys(fieldErrors).length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[13px]">
              {(Object.entries(fieldErrors) as Array<[keyof FicheErrors, string]>).map(([k, msg]) => (
                <li key={k}>
                  <button type="button" onClick={() => goToField(k)} className="underline decoration-red-300 underline-offset-2 hover:decoration-red-600 text-left">
                    {labelOfField(k)}
                  </button>
                  {' — '}{msg}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Onglets */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-px">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold rounded-t-lg whitespace-nowrap transition-colors border-b-2 ${tab === key ? 'text-bo-accent border-bo-accent bg-bo-accent/[0.04]' : 'text-gray-400 border-transparent hover:text-gray-600'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-soft p-6">
        {tab === 'general' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Nom du produit *" {...fp('name')}><input className={inputCls} value={form.name} onChange={(e) => applyNameChange(e.target.value)} /></Field>
            <Field label={isEdit ? 'Code EAN' : 'Code EAN *'} {...fp('ean')} hint={isEdit ? 'Immuable après création (anti-doublon par magasin).' : 'EAN-8 ou EAN-13, chiffres uniquement (clé de contrôle vérifiée).'}>
              <input className={`${inputCls} font-mono`} value={form.ean} disabled={isEdit} onChange={(e) => set('ean', e.target.value)} />
            </Field>
            <Field label="Désignation / description" {...fp('description')}><textarea rows={3} className={inputCls} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
            <div className="space-y-5">
              <Field label="Catégorie (facultative)" {...fp('categoryId')} hint="« Aucune » n'empêche pas l'enregistrement. Arborescence gérée dans Catalogue › Catégories.">
                <div className="flex gap-2">
                  <select className={inputCls} value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                    <option value="">— Aucune —</option>
                    {catOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    {form.categoryId && !categories.some((c) => c.id === form.categoryId) && (
                      <option value={form.categoryId}>{form.categoryId} (actuel)</option>
                    )}
                  </select>
                  <button
                    onClick={() => { setShowCatForm((v) => !v); setCatError(null); }}
                    className="px-3 rounded-xl border border-gray-200 text-gray-500 hover:text-bo-accent"
                    title="Nouvelle catégorie"
                  ><Plus size={15} /></button>
                </div>
                {showCatForm && (
                  <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-2">
                    <input
                      className={inputCls}
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !catBusy && createCategoryInline()}
                      placeholder="Nom de la catégorie…"
                      autoFocus
                    />
                    <select className={inputCls} value={newCatParent} onChange={(e) => setNewCatParent(e.target.value)}>
                      <option value="">Catégorie principale (aucun parent)</option>
                      {catOptions.map((o) => <option key={o.id} value={o.id}>Sous {o.label}</option>)}
                    </select>
                    {catError && <p className="text-xs text-red-600">{catError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={createCategoryInline}
                        disabled={catBusy}
                        className="px-3 py-2 rounded-lg bg-bo-accent text-white text-xs font-semibold disabled:opacity-50"
                      >{catBusy ? 'Création…' : 'Créer et sélectionner'}</button>
                      <button
                        onClick={() => { setShowCatForm(false); setCatError(null); }}
                        className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-500"
                      >Annuler</button>
                    </div>
                  </div>
                )}
              </Field>
              <Field label="SKU interne" {...fp('sku')}><input className={`${inputCls} font-mono`} value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="SKU-001" /></Field>
            </div>
            <Field label="Marque" {...fp('brandId')}>
              <div className="flex gap-2">
                <select className={inputCls} value={form.brandId} onChange={(e) => applyBrandChange(e.target.value)}>
                  <option value="">— Aucune —</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <button onClick={createBrand} className="px-3 rounded-xl border border-gray-200 text-gray-500 hover:text-bo-accent" title="Nouvelle marque"><Plus size={15} /></button>
              </div>
            </Field>
            <Field label="Unité de vente" {...fp('unitType')}>
              <select className={inputCls} value={form.unitType} onChange={(e) => set('unitType', e.target.value)}>
                <option value="unit">À l'unité</option><option value="kg">Au poids (kg)</option>
              </select>
            </Field>
            <Field label="Statut" {...fp('status')} hint="Seul « Actif » est vendable en caisse.">
              <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="active">Actif</option>
                <option value="draft">Brouillon</option>
                <option value="archived">Archivé</option>
                {['pending_validation', 'rejected'].includes(form.status) && (
                  <option value={form.status}>{form.status}</option>
                )}
              </select>
            </Field>
            <Field label="Nom court (caisse)" {...fp('shortName')} hint="Proposé automatiquement depuis le nom — modifiable ; votre saisie n'est jamais écrasée.">
              <input className={inputCls} value={form.shortName} onChange={(e) => set('shortName', e.target.value)} placeholder="ex : Coca 33" maxLength={120} />
            </Field>
            <Field label="Référence interne" {...fp('internalRef')}><input className={`${inputCls} font-mono`} value={form.internalRef} onChange={(e) => set('internalRef', e.target.value)} placeholder="INT-0001" /></Field>
            <Field label="Type de produit" {...fp('productType')}>
              <select className={inputCls} value={form.productType} onChange={(e) => set('productType', e.target.value)}>
                <option value="simple">Produit simple</option>
                <option value="variant">Variante</option>
                <option value="pack">Pack / kit</option>
                <option value="service">Service</option>
                <option value="deposit">Consigne</option>
                <option value="gift_card">Carte cadeau</option>
              </select>
            </Field>
            {isEdit ? (
              <div className="md:col-span-2 space-y-2">
                <label className={labelCls}>Codes-barres additionnels ({barcodes.length})</label>
                <div className="flex gap-2">
                  <input className={`${inputCls} font-mono`} value={newBarcode} onChange={(e) => setNewBarcode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addBarcode()} placeholder="EAN / UPC / GTIN…" />
                  <select className={inputCls} style={{ maxWidth: 120 }} value={newBarcodeType} onChange={(e) => setNewBarcodeType(e.target.value)}>
                    <option value="ean">EAN</option><option value="upc">UPC</option><option value="gtin">GTIN</option><option value="other">Autre</option>
                  </select>
                  <button onClick={addBarcode} className="px-4 rounded-xl bg-bo-accent text-white text-sm font-semibold flex items-center"><Plus size={15} /></button>
                </div>
                {barcodes.length > 0 && (
                  <ul className="divide-y divide-gray-50 rounded-xl border border-gray-100">
                    {barcodes.map((b) => (
                      <li key={b.id} className="py-1.5 px-3 flex items-center gap-2 text-sm">
                        <span className="font-mono text-bo-text">{b.barcode}</span>
                        <span className="text-[10px] uppercase text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{b.type}</span>
                        {b.isPrimary
                          ? <span className="text-[11px] font-semibold text-emerald-600">principal</span>
                          : <button onClick={() => setPrimaryBarcode(b.id)} className="text-[11px] text-bo-accent hover:underline">définir principal</button>}
                        <div className="flex-1" />
                        <button onClick={() => removeBarcode(b.id)} className="p-1 text-red-400 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-gray-400">Le code EAN principal (ci-dessus) reste le code historique du produit.</p>
              </div>
            ) : (
              <Phase2Notice fields="Codes-barres multiples : enregistrez d'abord la fiche pour les gérer." />
            )}
          </div>
        )}

        {tab === 'tarification' && (
          <div className="space-y-6">
            {/* Saisie BIDIRECTIONNELLE (reprise fiche P1 #84) : HT édité → TTC recalculé ;
                TTC édité → HT dérivé ; TVA changée pendant l'édition du HT → TTC recalculé
                depuis le HT affiché. Cycle sans dérive prouvé par pricingMath.test. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              <Field label="Prix d'achat HT (€)" {...fp('cost')}><input className={inputCls} inputMode="decimal" value={form.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
              <Field label="Prix d'achat TTC (calc.)"><input className={`${inputCls} bg-gray-50`} disabled value={eur(calc.costTtc)} /></Field>
              <Field label="Prix de vente HT (€)">
                <input
                  className={inputCls} inputMode="decimal"
                  value={htInput !== null ? htInput : (calc.ht != null ? minorToEurosInput(calc.ht) : '')}
                  onChange={(e) => {
                    setHtInput(e.target.value);
                    const ht = eurosInputToMinor(e.target.value);
                    const t = parseTaxRate(form.taxRate);
                    if (ht != null && t != null) set('priceTtc', minorToEurosInput(ttcFromHt(ht, t)));
                  }}
                />
              </Field>
              <Field label="Prix de vente TTC (€) *" {...fp('priceTtc')}>
                <input
                  className={inputCls} inputMode="decimal" value={form.priceTtc}
                  onChange={(e) => { setHtInput(null); set('priceTtc', e.target.value); }}
                />
              </Field>
              <Field label="TVA (%)" {...fp('taxRate')}>
                <input
                  className={inputCls} inputMode="decimal" value={form.taxRate}
                  onChange={(e) => {
                    const newRate = e.target.value;
                    set('taxRate', newRate);
                    const ht = htInput !== null ? eurosInputToMinor(htInput) : null;
                    const t = parseTaxRate(newRate);
                    if (ht != null && t != null) set('priceTtc', minorToEurosInput(ttcFromHt(ht, t)));
                  }}
                />
              </Field>
            </div>
            {/* Marges automatiques */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                ['Marge (€ HT)', eur(calc.margeM)],
                ['Taux de marge (/PA)', calc.tauxMarge != null ? calc.tauxMarge.toFixed(1) + ' %' : '—'],
                ['Taux de marque (/PV HT)', calc.tauxMarque != null ? calc.tauxMarque.toFixed(1) + ' %' : '—'],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
                  <p className="text-[11px] font-semibold text-gray-400">{l}</p>
                  <p className="text-lg font-bold text-bo-text tabular-nums">{v}</p>
                </div>
              ))}
            </div>
            {isEdit && original && toMinor(form.priceTtc) !== original.priceMinorUnits && (
              <Field label="Motif du changement de prix (journalisé dans l'historique)">
                <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex : hausse fournisseur" />
              </Field>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              <Field label="Prix minimum autorisé (€)" {...fp('minPrice')} hint="Le PV ne devrait pas descendre en dessous."><input className={inputCls} inputMode="decimal" value={form.minPrice} onChange={(e) => set('minPrice', e.target.value)} /></Field>
              <Field label="Prix conseillé (€)" {...fp('recommendedPrice')}><input className={inputCls} inputMode="decimal" value={form.recommendedPrice} onChange={(e) => set('recommendedPrice', e.target.value)} /></Field>
            </div>
            {(() => {
              const ttc = toMinor(form.priceTtc); const min = toMinor(form.minPrice);
              if (ttc != null && min != null && ttc < min) {
                return <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-800">⚠️ Prix de vente ({eur(ttc)}) inférieur au minimum autorisé ({eur(min)}).</div>;
              }
              return null;
            })()}
          </div>
        )}

        {tab === 'stock' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              <Field label="Stock actuel" {...fp('stock')}><input className={inputCls} inputMode="numeric" value={form.stock} onChange={(e) => set('stock', e.target.value)} /></Field>
              <Field label="Seuil d'alerte" {...fp('alertThreshold')}><input className={inputCls} inputMode="numeric" value={form.alertThreshold} onChange={(e) => set('alertThreshold', e.target.value)} /></Field>
              <Field label="Seuil critique" {...fp('criticalThreshold')}><input className={inputCls} inputMode="numeric" value={form.criticalThreshold} onChange={(e) => set('criticalThreshold', e.target.value)} /></Field>
            </div>
            {/* Saisonnalité (Lot E) */}
            <div className="rounded-xl border border-gray-100 p-4 space-y-3">
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.isSeasonal} onChange={(e) => set('isSeasonal', e.target.checked)} className="accent-bo-accent" /> Produit saisonnier</label>
              {form.isSeasonal && (
                <div className="grid grid-cols-2 gap-3 max-w-md">
                  <Field label="Mois de début" {...fp('seasonStartMonth')}>
                    <select className={inputCls} value={form.seasonStartMonth} onChange={(e) => set('seasonStartMonth', e.target.value)}>
                      <option value="">—</option>
                      {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                  </Field>
                  <Field label="Mois de fin" {...fp('seasonEndMonth')}>
                    <select className={inputCls} value={form.seasonEndMonth} onChange={(e) => set('seasonEndMonth', e.target.value)}>
                      <option value="">—</option>
                      {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                  </Field>
                </div>
              )}
            </div>
            <Phase2Notice fields="Stock minimum/maximum · quantité de réapprovisionnement · emplacement réserve/rayon (les emplacements physiques existent dans le module Stock Locations)" />
          </div>
        )}

        {tab === 'fournisseurs' && (
          <div className="space-y-6">
            <Field label="Fournisseur principal" {...fp('supplierId')}>
              <div className="flex gap-2">
                <select className={inputCls} value={form.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
                  <option value="">— Aucun —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={createSupplier} className="px-3 rounded-xl border border-gray-200 text-gray-500 hover:text-bo-accent" title="Nouveau fournisseur"><Plus size={15} /></button>
              </div>
            </Field>
            {supplier && (
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {[['Email', supplier.email], ['Téléphone', supplier.phone], ['Pays', supplier.country], ['Notes', supplier.notes]].map(([l, v]) => (
                  <div key={l as string}><p className="text-[11px] font-semibold text-gray-400">{l}</p><p className="text-gray-700">{(v as string) || '—'}</p></div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Field label="Référence fournisseur" {...fp('supplierRef')}><input className={`${inputCls} font-mono`} value={form.supplierRef} onChange={(e) => set('supplierRef', e.target.value)} placeholder="FRS-REF" /></Field>
              <Field label="Délai (jours)" {...fp('leadTimeDays')}><input className={inputCls} inputMode="numeric" value={form.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value)} /></Field>
              <Field label="MOQ (qté min. commande)" {...fp('minOrderQuantity')}><input className={inputCls} inputMode="numeric" value={form.minOrderQuantity} onChange={(e) => set('minOrderQuantity', e.target.value)} /></Field>
              <Field label="Pays d'origine" {...fp('countryOfOrigin')}><input className={inputCls} value={form.countryOfOrigin} onChange={(e) => set('countryOfOrigin', e.target.value)} placeholder="France" /></Field>
            </div>
            {isEdit ? (
              <div className="space-y-3 border-t border-gray-100 pt-4">
                <p className="text-sm font-semibold text-bo-text">Fournisseurs &amp; conditions d'achat ({prodSuppliers.length})</p>
                {prodSuppliers.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead><tr className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100"><th className="py-1.5">Fournisseur</th><th>Réf</th><th className="text-right">Prix achat</th><th className="text-right">Délai</th><th className="text-right">MOQ</th><th>Incoterm</th><th /></tr></thead>
                      <tbody>
                        {prodSuppliers.map((r) => {
                          const sup = suppliers.find((s) => s.id === r.supplierId);
                          return (
                            <tr key={r.id} className="border-b border-gray-50">
                              <td className="py-2 font-medium text-gray-700">{sup?.name || r.supplierId}{r.isPrimary && <span className="ml-2 text-[11px] font-semibold text-emerald-600">principal</span>}</td>
                              <td className="text-gray-500 font-mono text-xs">{r.supplierRef || '—'}</td>
                              <td className="text-right tabular-nums">{r.purchasePriceMinorUnits != null ? `${(r.purchasePriceMinorUnits / 100).toFixed(2)} ${r.currencyCode}` : '—'}</td>
                              <td className="text-right tabular-nums">{r.leadTimeDays ?? '—'}</td>
                              <td className="text-right tabular-nums">{r.minOrderQuantity ?? '—'}</td>
                              <td className="text-gray-500">{r.incoterm || '—'}</td>
                              <td className="text-right whitespace-nowrap">
                                {!r.isPrimary && <button onClick={() => setPrimaryProdSupplier(r.id)} className="text-[11px] text-bo-accent hover:underline mr-2">principal</button>}
                                <button onClick={() => removeProdSupplier(r.id)} className="p-1 text-red-400 hover:bg-red-50 rounded-lg inline-flex"><Trash2 size={13} /></button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end rounded-xl bg-gray-50 p-3">
                  <Field label="Fournisseur">
                    <select className={inputCls} value={psForm.supplierId} onChange={(e) => setPsForm({ ...psForm, supplierId: e.target.value })}>
                      <option value="">— Choisir —</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Réf fournisseur"><input className={inputCls} value={psForm.supplierRef} onChange={(e) => setPsForm({ ...psForm, supplierRef: e.target.value })} /></Field>
                  <Field label="Prix achat"><input className={inputCls} inputMode="decimal" value={psForm.purchasePrice} onChange={(e) => setPsForm({ ...psForm, purchasePrice: e.target.value })} /></Field>
                  <Field label="Devise"><input className={inputCls} value={psForm.currencyCode} onChange={(e) => setPsForm({ ...psForm, currencyCode: e.target.value })} /></Field>
                  <Field label="Délai (j)"><input className={inputCls} inputMode="numeric" value={psForm.leadTimeDays} onChange={(e) => setPsForm({ ...psForm, leadTimeDays: e.target.value })} /></Field>
                  <Field label="MOQ"><input className={inputCls} inputMode="numeric" value={psForm.minOrderQuantity} onChange={(e) => setPsForm({ ...psForm, minOrderQuantity: e.target.value })} /></Field>
                  <Field label="Incoterm"><input className={inputCls} value={psForm.incoterm} onChange={(e) => setPsForm({ ...psForm, incoterm: e.target.value })} placeholder="DDP, FOB…" /></Field>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={psForm.isPrimary} onChange={(e) => setPsForm({ ...psForm, isPrimary: e.target.checked })} className="accent-bo-accent" /> principal</label>
                    <button onClick={addProdSupplier} className="px-3 py-2 rounded-lg bg-bo-accent text-white text-sm font-semibold flex items-center gap-1 whitespace-nowrap"><Plus size={14} /> Ajouter</button>
                  </div>
                </div>
              </div>
            ) : (
              <Phase2Notice fields="Fournisseurs multiples : enregistrez d'abord la fiche pour ajouter des fournisseurs et leurs conditions d'achat." />
            )}
          </div>
        )}

        {tab === 'packs' && (
          <div className="space-y-5">
            {!isEdit ? <p className="text-sm text-gray-400">Enregistrez d'abord la fiche pour composer un pack.</p> : (
              <>
                <div className="flex gap-2 items-end flex-wrap">
                  <div className="flex-1 min-w-[220px]"><Field label="EAN du composant"><input className={`${inputCls} font-mono`} value={compEan} onChange={(e) => setCompEan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addComponent()} placeholder="Scanner le composant…" /></Field></div>
                  <div className="w-28"><Field label="Quantité"><input className={inputCls} inputMode="numeric" value={compQty} onChange={(e) => setCompQty(e.target.value)} /></Field></div>
                  <button onClick={addComponent} className="px-4 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold flex items-center gap-1.5"><Plus size={14} /> Ajouter</button>
                </div>
                {components.length === 0 ? <p className="text-sm text-gray-400">Produit simple (aucun composant). Ajoutez des composants pour en faire un pack / kit / produit composé — le stock des composants est décrémenté à la vente.</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100"><th className="py-2">Composant</th><th>EAN</th><th className="text-center">Qté / pack</th><th /></tr></thead>
                    <tbody>{components.map((c) => (
                      <tr key={c.id} className="border-b border-gray-50">
                        <td className="py-2.5 font-medium text-gray-700">{c.componentProduct?.name || c.componentProductId}</td>
                        <td className="font-mono text-xs text-gray-400">{c.componentProduct?.ean || '—'}</td>
                        <td className="text-center tabular-nums font-semibold">{c.quantityPerParent}</td>
                        <td className="text-right"><button onClick={() => removeComponent(c.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={15} /></button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'variantes' && (
          <div className="space-y-5">
            {!isEdit ? <p className="text-sm text-gray-400">Enregistrez d'abord la fiche pour créer des variantes.</p> : original?.parentProductId ? (
              <p className="text-sm text-gray-400">Cette fiche est elle-même une variante — les variantes se gèrent sur la fiche parente.</p>
            ) : (
              <>
                {/* Générateur par attributs (Lot C) */}
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4 space-y-3">
                  <p className="text-sm font-semibold text-bo-text">Générer par attributs (taille × couleur × parfum…)</p>
                  {genAttributes.map((a, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input className={`${inputCls} max-w-[160px]`} value={a.name} placeholder="Attribut (ex : Taille)" onChange={(e) => setGenAttributes(genAttributes.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                      <input className={inputCls} value={a.values} placeholder="Valeurs séparées par des virgules (S, M, L)" onChange={(e) => setGenAttributes(genAttributes.map((x, j) => j === i ? { ...x, values: e.target.value } : x))} />
                      {genAttributes.length > 1 && <button onClick={() => setGenAttributes(genAttributes.filter((_, j) => j !== i))} className="p-2 text-red-400 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>}
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <button onClick={() => setGenAttributes([...genAttributes, { name: '', values: '' }])} className="text-xs text-bo-accent hover:underline flex items-center gap-1"><Plus size={13} /> Ajouter un attribut</button>
                    <div className="flex-1" />
                    {genMsg && <span className="text-xs text-bo-text">{genMsg}</span>}
                    <button onClick={runGenerateVariants} disabled={genBusy} className="px-4 py-2 rounded-lg bg-bo-accent text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5">
                      {genBusy && <Loader2 size={13} className="animate-spin" />} Générer les variantes
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400">Chaque combinaison devient une variante avec un EAN interne généré. Les combinaisons déjà présentes sont ignorées.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <Field label="Nom de la variante"><input className={inputCls} value={vName} onChange={(e) => setVName(e.target.value)} placeholder="ex : 500g / Rouge / Fraise" /></Field>
                  <Field label="EAN de la variante"><input className={`${inputCls} font-mono`} value={vEan} onChange={(e) => setVEan(e.target.value)} /></Field>
                  <Field label="Prix TTC (€)"><input className={inputCls} inputMode="decimal" value={vPrice} onChange={(e) => setVPrice(e.target.value)} /></Field>
                  <button onClick={addVariant} className="px-4 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold flex items-center gap-1.5"><Plus size={14} /> Créer</button>
                </div>
                {variants.length === 0 ? <p className="text-sm text-gray-400">Aucune variante (taille, couleur, volume, parfum, modèle…).</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100"><th className="py-2">Variante</th><th>EAN</th><th>SKU</th><th className="text-right">Prix</th><th className="text-right">Stock</th></tr></thead>
                    <tbody>{variants.map((v) => (
                      <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/products/${v.id}/edit`)}>
                        <td className="py-2.5 font-medium text-gray-700">{v.variantName || v.name}</td>
                        <td className="font-mono text-xs text-gray-400">{v.ean}</td>
                        <td className="font-mono text-xs text-gray-400">{v.sku || '—'}</td>
                        <td className="text-right tabular-nums">{eur(v.priceMinorUnits)}</td>
                        <td className="text-right tabular-nums">{v.stockQuantity}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'lies' && (
          <div className="space-y-5">
            {!isEdit ? <p className="text-sm text-gray-400">Enregistrez la fiche pour lier des produits.</p> : (
              <>
                <div className="rounded-xl bg-gray-50 p-3 space-y-2">
                  <div className="flex gap-2 items-center">
                    <select className={inputCls} style={{ maxWidth: 200 }} value={linkType} onChange={(e) => setLinkType(e.target.value)}>
                      <option value="complementary">Complémentaire</option>
                      <option value="cross_sell">Vente croisée</option>
                      <option value="substitute">Substitution</option>
                    </select>
                    <input className={inputCls} value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)} placeholder="Rechercher un produit à lier (nom / EAN / SKU)…" />
                  </div>
                  {linkResults.length > 0 && (
                    <ul className="max-h-40 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                      {linkResults.map((p) => (
                        <li key={p.id}>
                          <button onClick={() => addLink(p.id)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                            <span className="font-medium text-bo-text">{p.name}</span>
                            <span className="ml-2 text-gray-400 font-mono text-xs">{p.ean}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {links.length === 0 ? (
                  <p className="text-sm text-gray-400">Aucun produit lié. Ajoutez des produits complémentaires, de vente croisée ou de substitution.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100"><th className="py-2">Produit lié</th><th>EAN</th><th>Type</th><th /></tr></thead>
                    <tbody>
                      {links.map((l) => (
                        <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/products/${l.linkedProductId}`)}>
                          <td className="py-2 font-medium text-gray-700">{l.linkedProduct?.name || l.linkedProductId}</td>
                          <td className="font-mono text-xs text-gray-400">{l.linkedProduct?.ean || '—'}</td>
                          <td className="text-gray-500">{LINK_LABEL[l.linkType] || l.linkType}</td>
                          <td className="text-right" onClick={(e) => e.stopPropagation()}><button onClick={() => removeLink(l.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'images' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
              <Field label="Photo principale (URL ou fichier)" {...fp('imageUrl')} hint="JPG, PNG ou WebP — compressée automatiquement avant enregistrement. Vider = retirer l'image.">
                <input className={inputCls} value={form.imageUrl.startsWith('data:') ? '(image chargée depuis un fichier)' : form.imageUrl} disabled={form.imageUrl.startsWith('data:')} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" />
                {/* input file piloté par ref + bouton explicite : plus robuste que
                    l'activation implicite par <label> (variable selon navigateurs). */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={(e) => { onPickImage(e.target.files?.[0]); e.target.value = ''; }}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={imageBusy}
                    className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:border-bo-accent disabled:opacity-50"
                  >{imageBusy ? 'Préparation…' : 'Choisir un fichier…'}</button>
                  {form.imageUrl && (
                    <button type="button" onClick={() => { set('imageUrl', ''); setImageError(null); }} className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-500">Retirer</button>
                  )}
                </div>
                {imageError && <p className="mt-2 text-xs text-red-600">{imageError}</p>}
              </Field>
              <div className="rounded-xl border border-dashed border-gray-200 min-h-[160px] flex items-center justify-center bg-gray-50/50">
                {form.imageUrl ? <img src={form.imageUrl} alt="" className="max-h-48 max-w-full object-contain rounded-lg" /> : <p className="text-xs text-gray-300">Aperçu</p>}
              </div>
            </div>
            {!isEdit ? (
              <p className="text-sm text-gray-400">Enregistrez la fiche pour gérer la galerie et les documents.</p>
            ) : (
              <>
                {/* Galerie (photos secondaires — URLs) */}
                <div className="space-y-3 border-t border-gray-100 pt-4">
                  <p className="text-sm font-semibold text-bo-text">Galerie ({media.length})</p>
                  <div className="flex gap-2">
                    <input className={inputCls} value={newMediaUrl} onChange={(e) => setNewMediaUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMedia()} placeholder="URL d'une image…" />
                    <button onClick={addMedia} className="px-4 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold whitespace-nowrap flex items-center gap-1.5"><Plus size={14} /> Ajouter</button>
                  </div>
                  {media.length > 0 && (
                    <>
                      <div className="flex flex-wrap gap-3">
                        {media.map((m, idx) => (
                          <div
                            key={m.id}
                            draggable
                            onDragStart={() => setDragMediaIdx(idx)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => { if (dragMediaIdx !== null) moveMedia(dragMediaIdx, idx); setDragMediaIdx(null); }}
                            className={`relative w-24 h-24 rounded-xl border bg-gray-50 overflow-hidden group cursor-move ${dragMediaIdx === idx ? 'border-bo-accent opacity-60' : 'border-gray-100'}`}
                          >
                            <img src={m.url} alt="" className="w-full h-full object-contain pointer-events-none" />
                            {idx === 0 && <span className="absolute bottom-1 left-1 text-[9px] font-semibold bg-white/90 text-bo-accent px-1 rounded">principale</span>}
                            <button onClick={() => removeMedia(m.id)} className="absolute top-1 right-1 p-1 rounded-lg bg-white/90 text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-gray-400">Glissez-déposez pour réordonner ; la première image est la principale.</p>
                    </>
                  )}
                </div>

                {/* Documents (notices, fiches, certificats — URLs) */}
                <div className="space-y-3 border-t border-gray-100 pt-4">
                  <p className="text-sm font-semibold text-bo-text">Documents ({documents.length})</p>
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2">
                    <input className={inputCls} value={newDocName} onChange={(e) => setNewDocName(e.target.value)} placeholder="Nom (ex : Notice)" />
                    <input className={inputCls} value={newDocUrl} onChange={(e) => setNewDocUrl(e.target.value)} placeholder="URL du document (PDF…)" />
                    <button onClick={addDocument} className="px-4 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold flex items-center gap-1.5"><Plus size={14} /> Ajouter</button>
                  </div>
                  {documents.length > 0 && (
                    <ul className="divide-y divide-gray-50">
                      {documents.map((d) => (
                        <li key={d.id} className="py-2 flex items-center gap-2 text-sm">
                          <a href={d.url} target="_blank" rel="noreferrer" className="text-bo-accent hover:underline font-medium">{d.name}</a>
                          <span className="text-gray-400 font-mono text-xs truncate flex-1">{d.url}</span>
                          <button onClick={() => removeDocument(d.id)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'logistique' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              <Field label="Poids (g)" {...fp('weightGrams')}><input className={inputCls} inputMode="numeric" value={form.weightGrams} onChange={(e) => set('weightGrams', e.target.value)} /></Field>
              <Field label="Largeur (mm)" {...fp('widthMm')}><input className={inputCls} inputMode="numeric" value={form.widthMm} onChange={(e) => set('widthMm', e.target.value)} /></Field>
              <Field label="Hauteur (mm)" {...fp('heightMm')}><input className={inputCls} inputMode="numeric" value={form.heightMm} onChange={(e) => set('heightMm', e.target.value)} /></Field>
              <Field label="Profondeur (mm)" {...fp('depthMm')}><input className={inputCls} inputMode="numeric" value={form.depthMm} onChange={(e) => set('depthMm', e.target.value)} /></Field>
              <Field label="Volume (ml)" {...fp('volumeMl')}><input className={inputCls} inputMode="numeric" value={form.volumeMl} onChange={(e) => set('volumeMl', e.target.value)} /></Field>
              <Field label="Unités / carton" {...fp('unitsPerCarton')}><input className={inputCls} inputMode="numeric" value={form.unitsPerCarton} onChange={(e) => set('unitsPerCarton', e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              <Field label="Unités / colis" {...fp('unitsPerPack')}><input className={inputCls} inputMode="numeric" value={form.unitsPerPack} onChange={(e) => set('unitsPerPack', e.target.value)} /></Field>
              <Field label="Cartons / palette" {...fp('cartonsPerPallet')}><input className={inputCls} inputMode="numeric" value={form.cartonsPerPallet} onChange={(e) => set('cartonsPerPallet', e.target.value)} /></Field>
            </div>

            {/* Réglementaire / alimentaire (selon le type de produit) */}
            <div className="border-t border-gray-100 pt-4 space-y-4">
              <p className="text-sm font-semibold text-bo-text">Réglementaire / alimentaire</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Allergènes" {...fp('allergens')}><textarea rows={2} className={inputCls} value={form.allergens} onChange={(e) => set('allergens', e.target.value)} placeholder="ex : gluten, fruits à coque…" /></Field>
                <Field label="Ingrédients" {...fp('ingredients')}><textarea rows={2} className={inputCls} value={form.ingredients} onChange={(e) => set('ingredients', e.target.value)} /></Field>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                <Field label="DDM (durabilité min.)" {...fp('bestBeforeDate')}><input type="date" className={inputCls} value={form.bestBeforeDate} onChange={(e) => set('bestBeforeDate', e.target.value)} /></Field>
                <Field label="DLC (limite consommation)" {...fp('useByDate')}><input type="date" className={inputCls} value={form.useByDate} onChange={(e) => set('useByDate', e.target.value)} /></Field>
                <Field label="Numéro de lot" {...fp('lotNumber')}><input className={`${inputCls} font-mono`} value={form.lotNumber} onChange={(e) => set('lotNumber', e.target.value)} /></Field>
              </div>
            </div>
            <Phase2Notice fields="Emplacement réserve/rayon (module Stock Locations) · matière — à venir" />
          </div>
        )}

        {tab === 'promotions' && (
          <div className="space-y-5">
            {!isEdit ? <p className="text-sm text-gray-400">Enregistrez d'abord la fiche.</p> : (
              <>
                {storePrice?.priceMinorUnits != null && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 flex items-center justify-between">
                    <div className="text-sm text-emerald-800">
                      <p className="font-semibold">Prix promotionnel actif : {eur(storePrice.priceMinorUnits)}</p>
                      <p className="text-xs">{storePrice.startsAt ? `du ${new Date(storePrice.startsAt).toLocaleDateString('fr-FR')}` : 'sans date de début'} {storePrice.endsAt ? `au ${new Date(storePrice.endsAt).toLocaleDateString('fr-FR')}` : '· sans date de fin'}</p>
                    </div>
                    <button onClick={clearPromo} className="text-xs font-semibold text-red-600 hover:underline">Supprimer</button>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <Field label="Prix promotionnel TTC (€)"><input className={inputCls} inputMode="decimal" value={promoPrice} onChange={(e) => setPromoPrice(e.target.value)} /></Field>
                  <Field label="Début"><input type="date" className={inputCls} value={promoStart} onChange={(e) => setPromoStart(e.target.value)} /></Field>
                  <Field label="Fin"><input type="date" className={inputCls} value={promoEnd} onChange={(e) => setPromoEnd(e.target.value)} /></Field>
                  <button onClick={savePromo} className="px-4 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold">Programmer</button>
                </div>
                <p className="text-[11px] text-gray-400">Mécanisme réel existant (prix magasin à fenêtre) — appliqué automatiquement en caisse pendant la période. Les promos multi-produits (lots, buy X get Y, codes) se gèrent dans Promotions / Codes promo.</p>
                <Phase2Notice fields="Fidélité : points gagnés/nécessaires/exclusions par produit (le programme Wesley Club existe, sans paramétrage par produit)" />
              </>
            )}
          </div>
        )}

        {tab === 'stats' && (
          <div className="space-y-5">
            {!isEdit ? <p className="text-sm text-gray-400">Disponible après création.</p> : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    ['Stock restant', String(original?.stockQuantity ?? '—')],
                    ['Prix actuel', eur(original?.priceMinorUnits)],
                    ["Prix d'achat", eur(original?.costMinorUnits)],
                    ['Créé le', original?.createdAt ? new Date(original.createdAt).toLocaleDateString('fr-FR') : '—'],
                  ].map(([l, v]) => (
                    <div key={l as string} className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3"><p className="text-[11px] font-semibold text-gray-400">{l}</p><p className="text-lg font-bold text-bo-text tabular-nums">{v}</p></div>
                  ))}
                </div>
                {analytics ? (
                  <pre className="text-xs bg-gray-50 border border-gray-100 rounded-xl p-4 overflow-auto max-h-64">{JSON.stringify(analytics, null, 2)}</pre>
                ) : <p className="text-sm text-gray-400">Analytics d'impact prix : aucune donnée pour ce produit (ou endpoint indisponible).</p>}
                <p className="text-[11px] text-gray-400">Ventes / CA / rotation réseau : Rapports → Analytics produits (données réelles agrégées). Date de dernier achat : nécessite le module réceptions (inexistant — jamais simulé).</p>
              </>
            )}
          </div>
        )}

        {tab === 'historique' && (
          <div className="space-y-4">
            {!isEdit ? <p className="text-sm text-gray-400">Disponible après création.</p> : priceHistory.length === 0 ? (
              <p className="text-sm text-gray-400">Aucune modification de prix enregistrée.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100"><th className="py-2">Date</th><th>Ancien prix</th><th>Nouveau prix</th><th>Par</th><th>Motif</th></tr></thead>
                <tbody>{priceHistory.map((h) => (
                  <tr key={h.id} className="border-b border-gray-50">
                    <td className="py-2.5 text-gray-600">{new Date(h.changedAt).toLocaleString('fr-FR')}</td>
                    <td className="tabular-nums text-gray-400">{eur(h.oldPriceMinorUnits)}</td>
                    <td className="tabular-nums font-semibold text-bo-text">{eur(h.newPriceMinorUnits)}</td>
                    <td className="text-xs text-gray-400">{h.changedByRole || '—'}</td>
                    <td className="text-xs text-gray-500">{h.reason || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            <p className="text-[11px] text-gray-400">Historique réel des changements de PRIX de vente (table price_history).</p>

            {/* Journal complet des modifications (Lot D) */}
            {isEdit && (
              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm font-semibold text-bo-text mb-2">Modifications de la fiche ({changeLog.length})</p>
                {changeLog.length === 0 ? (
                  <p className="text-sm text-gray-400">Aucune modification enregistrée (nom, prix d'achat, TVA, catégorie, fournisseur, statut…).</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[560px]">
                      <thead><tr className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100"><th className="py-2">Date</th><th>Champ</th><th>Avant</th><th>Après</th><th>Par</th></tr></thead>
                      <tbody>
                        {changeLog.map((c) => (
                          <tr key={c.id} className="border-b border-gray-50">
                            <td className="py-2 text-gray-600 whitespace-nowrap">{new Date(c.createdAt).toLocaleString('fr-FR')}</td>
                            <td className="text-gray-700 font-medium">{c.field}</td>
                            <td className="text-gray-400 tabular-nums">{c.oldValue || '—'}</td>
                            <td className="text-bo-text tabular-nums">{c.newValue || '—'}</td>
                            <td className="text-xs text-gray-400">{c.changedByRole || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-[11px] text-gray-400 mt-2">Journal réel (table product_change_log) : prix d'achat, TVA, fournisseur, catégorie, statut, dimensions…</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
