import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ScanBarcode, Save, ArrowLeft, Loader2, Package, Euro, Boxes, Truck,
  Layers, GitBranch, Image as ImageIcon, Ruler, BadgePercent, BarChart3,
  History, Plus, Trash2, AlertCircle, CheckCircle2, Pencil,
} from 'lucide-react';
import { productsApi } from '../services/api';

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
  | 'variantes' | 'images' | 'logistique' | 'promotions' | 'stats' | 'historique';

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'general', label: 'Général', icon: Package },
  { key: 'tarification', label: 'Tarification', icon: Euro },
  { key: 'stock', label: 'Stock', icon: Boxes },
  { key: 'fournisseurs', label: 'Fournisseurs', icon: Truck },
  { key: 'packs', label: 'Packs', icon: Layers },
  { key: 'variantes', label: 'Variantes', icon: GitBranch },
  { key: 'images', label: 'Images', icon: ImageIcon },
  { key: 'logistique', label: 'Logistique', icon: Ruler },
  { key: 'promotions', label: 'Promotions', icon: BadgePercent },
  { key: 'stats', label: 'Statistiques', icon: BarChart3 },
  { key: 'historique', label: 'Historique', icon: History },
];

const eur = (m: number | null | undefined) =>
  m == null ? '—' : (m / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const toMinor = (s: string) => {
  const v = parseFloat((s || '').replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
};

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bo-accent/20 focus:border-bo-accent/50';
const labelCls = 'block text-xs font-semibold text-gray-500 mb-1.5';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
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
  const isEdit = Boolean(id);

  // ── Porte « scanner d'abord » (création) ──
  const [gate, setGate] = useState(!isEdit);
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
  });
  const set = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));

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

  const load = useCallback(async () => {
    try {
      const [b, s, c] = await Promise.all([
        productsApi.listBrands(),
        productsApi.listSuppliers(),
        productsApi.listCategories(),
      ]);
      setBrands(b.data || []); setSuppliers(s.data || []);
      setCategories((c.data || []).map((x: any) => ({ id: x.id, name: x.name, parentId: x.parentId ?? null })));
      if (!id) { setLoading(false); return; }
      const p = (await productsApi.get(id)).data;
      setOriginal(p);
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
      });
      // Chargements non bloquants des onglets (endpoints existants)
      productsApi.listComponents(id).then((r) => setComponents(r.data || [])).catch(() => {});
      productsApi.listVariants(id).then((r) => setVariants(r.data || [])).catch(() => {});
      productsApi.getStorePrice(id).then((r) => setStorePrice(r.data || null)).catch(() => setStorePrice(null));
      productsApi.priceHistory(id).then((r) => setPriceHistory(r.data || [])).catch(() => {});
      productsApi.priceAnalytics(id).then((r) => setAnalytics(r.data || null)).catch(() => {});
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Chargement impossible');
    } finally { setLoading(false); }
  }, [id]);
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
    const ttc = toMinor(form.priceTtc);
    if (!form.name.trim()) { setError('Nom obligatoire.'); setTab('general'); return; }
    if (ttc == null) { setError('Prix de vente TTC invalide.'); setTab('tarification'); return; }
    if (!isEdit && !form.ean.trim()) { setError('EAN obligatoire.'); setTab('general'); return; }
    const common = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      categoryId: form.categoryId.trim() || undefined,
      unitType: form.unitType || undefined,
      priceMinorUnits: ttc,
      costMinorUnits: toMinor(form.cost) ?? undefined,
      taxRate: parseFloat(form.taxRate.replace(',', '.')) || undefined,
      stockQuantity: parseInt(form.stock, 10) || 0,
      stockAlertThreshold: parseInt(form.alertThreshold, 10) || undefined,
      stockCriticalThreshold: parseInt(form.criticalThreshold, 10) || undefined,
      imageUrl: form.imageUrl.trim() || undefined,
      brandId: form.brandId || undefined,
      supplierId: form.supplierId || undefined,
      sku: form.sku.trim() || undefined,
      status: form.status || undefined,
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
      setError(e?.response?.data?.message || 'Enregistrement impossible');
    } finally { setSaving(false); }
  };

  const createBrand = async () => {
    const name = window.prompt('Nom de la nouvelle marque :')?.trim();
    if (!name) return;
    const r = await productsApi.createBrand(name).catch(() => null);
    if (r?.data) { setBrands((b) => [...b, r.data]); set('brandId', r.data.id); }
  };
  const createSupplier = async () => {
    const name = window.prompt('Nom du nouveau fournisseur :')?.trim();
    if (!name) return;
    const r = await productsApi.createSupplier(name).catch(() => null);
    if (r?.data) { setSuppliers((s) => [...s, r.data]); set('supplierId', r.data.id); }
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

  // ══════════ PORTE SCANNER (création) ══════════
  if (gate) {
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
          {gateExisting && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-left">
              <p className="text-sm font-semibold text-amber-800 flex items-center gap-2"><AlertCircle size={15} /> Ce code-barres existe déjà</p>
              <p className="text-sm text-amber-700 mt-1">{gateExisting.name} — {eur(gateExisting.priceMinorUnits)}</p>
              <button onClick={() => navigate(`/products/${gateExisting.id}/edit`)} className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bo-accent text-white text-xs font-semibold"><Pencil size={13} /> Éditer le produit existant</button>
            </div>
          )}
          <div className="flex gap-2 justify-center">
            <button onClick={checkEan} disabled={gateBusy || !gateEan.trim()} className="px-5 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-2">
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

      {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{error}</div>}

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
            <Field label="Nom du produit *"><input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Code EAN" hint={isEdit ? 'Immuable après création (anti-doublon par magasin).' : undefined}>
              <input className={`${inputCls} font-mono`} value={form.ean} disabled={isEdit} onChange={(e) => set('ean', e.target.value)} />
            </Field>
            <Field label="Désignation / description"><textarea rows={3} className={inputCls} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
            <div className="space-y-5">
              <Field label="Catégorie" hint="Arborescence gérée dans Catalogue › Catégories.">
                <select className={inputCls} value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                  <option value="">— Aucune —</option>
                  {catOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  {form.categoryId && !categories.some((c) => c.id === form.categoryId) && (
                    <option value={form.categoryId}>{form.categoryId} (actuel)</option>
                  )}
                </select>
              </Field>
              <Field label="SKU interne"><input className={`${inputCls} font-mono`} value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="SKU-001" /></Field>
            </div>
            <Field label="Marque">
              <div className="flex gap-2">
                <select className={inputCls} value={form.brandId} onChange={(e) => set('brandId', e.target.value)}>
                  <option value="">— Aucune —</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <button onClick={createBrand} className="px-3 rounded-xl border border-gray-200 text-gray-500 hover:text-bo-accent" title="Nouvelle marque"><Plus size={15} /></button>
              </div>
            </Field>
            <Field label="Unité de vente">
              <select className={inputCls} value={form.unitType} onChange={(e) => set('unitType', e.target.value)}>
                <option value="unit">À l'unité</option><option value="kg">Au poids (kg)</option>
              </select>
            </Field>
            <Field label="Statut" hint="Seul « Actif » est vendable en caisse.">
              <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="active">Actif</option>
                <option value="draft">Brouillon</option>
                <option value="archived">Archivé</option>
                {['pending_validation', 'rejected'].includes(form.status) && (
                  <option value={form.status}>{form.status}</option>
                )}
              </select>
            </Field>
            <Phase2Notice fields="Désignation courte/longue séparées · sous-famille · code UPC · code interne" />
          </div>
        )}

        {tab === 'tarification' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              <Field label="Prix d'achat HT (€)"><input className={inputCls} inputMode="decimal" value={form.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
              <Field label="Prix d'achat TTC (calc.)"><input className={`${inputCls} bg-gray-50`} disabled value={eur(calc.costTtc)} /></Field>
              <Field label="Prix de vente TTC (€) *"><input className={inputCls} inputMode="decimal" value={form.priceTtc} onChange={(e) => set('priceTtc', e.target.value)} /></Field>
              <Field label="TVA (%)"><input className={inputCls} inputMode="decimal" value={form.taxRate} onChange={(e) => set('taxRate', e.target.value)} /></Field>
            </div>
            {/* Marges automatiques */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                ['Prix de vente HT', eur(calc.ht)],
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
            <Phase2Notice fields="Prix minimum autorisé · prix conseillé · devise d'achat (le prix promotionnel + dates existe déjà : onglet Promotions)" />
          </div>
        )}

        {tab === 'stock' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              <Field label="Stock actuel"><input className={inputCls} inputMode="numeric" value={form.stock} onChange={(e) => set('stock', e.target.value)} /></Field>
              <Field label="Seuil d'alerte"><input className={inputCls} inputMode="numeric" value={form.alertThreshold} onChange={(e) => set('alertThreshold', e.target.value)} /></Field>
              <Field label="Seuil critique"><input className={inputCls} inputMode="numeric" value={form.criticalThreshold} onChange={(e) => set('criticalThreshold', e.target.value)} /></Field>
            </div>
            <Phase2Notice fields="Stock minimum/maximum · quantité de réapprovisionnement · quantités carton/palette · emplacement · réserve · rayon (les emplacements physiques existent par ailleurs dans le module Stock Locations)" />
          </div>
        )}

        {tab === 'fournisseurs' && (
          <div className="space-y-6">
            <Field label="Fournisseur principal">
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
            <Phase2Notice fields="Fournisseur secondaire · référence fournisseur · contact dédié produit · délai de livraison · MOQ · conditionnement · devise · incoterm" />
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

        {tab === 'images' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
              <Field label="Photo principale (URL ou fichier)" hint="Un fichier choisi est converti en data-URL (stockage existant). Vider = retirer l'image.">
                <input className={inputCls} value={form.imageUrl.startsWith('data:') ? '(image chargée depuis un fichier)' : form.imageUrl} disabled={form.imageUrl.startsWith('data:')} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" />
                <div className="flex gap-2 mt-2">
                  <label className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 cursor-pointer hover:border-bo-accent">
                    Choisir un fichier…
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                      const f = e.target.files?.[0]; if (!f) return;
                      const r = new FileReader(); r.onload = () => set('imageUrl', String(r.result || '')); r.readAsDataURL(f);
                    }} />
                  </label>
                  {form.imageUrl && <button onClick={() => set('imageUrl', '')} className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-500">Retirer</button>}
                </div>
              </Field>
              <div className="rounded-xl border border-dashed border-gray-200 min-h-[160px] flex items-center justify-center bg-gray-50/50">
                {form.imageUrl ? <img src={form.imageUrl} alt="" className="max-h-48 max-w-full object-contain rounded-lg" /> : <p className="text-xs text-gray-300">Aperçu</p>}
              </div>
            </div>
            <Phase2Notice fields="Photos secondaires multiples · glisser-déposer · recadrage (nécessite table product_images + stockage objet)" />
          </div>
        )}

        {tab === 'logistique' && (
          <Phase2Notice fields="Poids · longueur · largeur · hauteur · volume — aucune colonne en base aujourd'hui : rien n'est affiché tant que la migration n'est pas validée." />
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
            <p className="text-[11px] text-gray-400">Historique réel des changements de PRIX (table price_history). Les modifications hors prix ne sont pas encore journalisées côté serveur — Phase 2 (audit product_updated).</p>
          </div>
        )}
      </div>
    </div>
  );
}
