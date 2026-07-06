import { useState, useRef, useEffect } from 'react';
import {
  ScanBarcode, X, CheckCircle2, AlertTriangle, Loader2, Lock,
  PackagePlus, Send, ShoppingCart,
} from 'lucide-react';
import { productIntegrationApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import {
  ProductIntegrationForm,
  EMPTY_INTEGRATION_FORM,
  buildProductPayload,
} from '../utils/productIntegration';

/**
 * Scan produit (douchette / saisie) — Dashboard & module Inventaire.
 *
 * Produit trouvé → fiche (nom, prix, stock, statut, dernières ventes).
 * Produit inconnu → « Produit inconnu » :
 *   - Créer une fiche produit  (code admin / employé autorisé OBLIGATOIRE)
 *   - Envoyer en attente de validation (demande d'intégration)
 *   - Annuler
 * La création est re-validée côté serveur (session manager/admin ou PIN).
 */

const INP =
  'w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent';

type ScanState =
  | { kind: 'idle' }
  | { kind: 'loading'; barcode: string }
  | { kind: 'found'; product: any; lastSales: any[] }
  | { kind: 'unknown'; barcode: string; pendingRequest: any | null };

interface Props {
  source: 'dashboard' | 'inventory';
  /** Notifie le parent (rafraîchir les files) après création/demande. */
  onChanged?: () => void;
}

function formatEuros(minor: number | null | undefined): string {
  if (minor == null) return '—';
  return (minor / 100).toFixed(2).replace('.', ',') + ' €';
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  active: { label: 'Actif', cls: 'bg-emerald-50 text-emerald-700' },
  pending_validation: { label: 'À valider', cls: 'bg-amber-50 text-amber-700' },
  draft: { label: 'Brouillon', cls: 'bg-gray-100 text-gray-600' },
  rejected: { label: 'Rejeté', cls: 'bg-red-50 text-red-700' },
  archived: { label: 'Archivé', cls: 'bg-gray-100 text-gray-500' },
};

export function ProductScanPanel({ source, onChanged }: Props) {
  const { employee } = useAuthStore();
  const isManager = employee?.role === 'admin' || employee?.role === 'manager';

  const [barcode, setBarcode] = useState('');
  const [scan, setScan] = useState<ScanState>({ kind: 'idle' });
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // PIN gate (code admin / employé autorisé) avant la création de fiche
  const [pinGate, setPinGate] = useState<{ open: boolean; pin: string; error: string; busy: boolean }>({
    open: false, pin: '', error: '', busy: false,
  });
  /** PIN validé pour cette création (envoyé au serveur avec la fiche). */
  const [grantedPin, setGrantedPin] = useState<string | null>(null);

  // Formulaire « Nouvelle fiche produit »
  const [form, setForm] = useState<ProductIntegrationForm | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [activate, setActivate] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doScan = async (value: string) => {
    const code = value.trim();
    if (!code) return;
    setNotice(null);
    setScan({ kind: 'loading', barcode: code });
    try {
      const res = await productIntegrationApi.scan(code, source);
      if (res.data?.found) {
        setScan({ kind: 'found', product: res.data.product, lastSales: res.data.lastSales ?? [] });
      } else {
        setScan({ kind: 'unknown', barcode: code, pendingRequest: res.data?.pendingRequest ?? null });
      }
    } catch {
      setScan({ kind: 'idle' });
      setNotice({ tone: 'err', text: 'Scan impossible (réseau ou session).' });
    }
    setBarcode('');
    inputRef.current?.focus();
  };

  /* ── Actions « produit inconnu » ── */

  const startCreate = () => {
    if (scan.kind !== 'unknown') return;
    if (isManager) {
      // Session back-office avec droit suffisant (RÈGLE 4) — pas de PIN.
      setGrantedPin(null);
      openForm(scan.barcode);
    } else {
      setPinGate({ open: true, pin: '', error: '', busy: false });
    }
  };

  const submitPin = async () => {
    if (!pinGate.pin.trim() || pinGate.busy || scan.kind !== 'unknown') return;
    setPinGate((g) => ({ ...g, busy: true, error: '' }));
    try {
      await productIntegrationApi.authorize(pinGate.pin.trim());
      setGrantedPin(pinGate.pin.trim());
      setPinGate({ open: false, pin: '', error: '', busy: false });
      openForm(scan.barcode);
    } catch {
      setPinGate((g) => ({ ...g, busy: false, error: 'Autorisation insuffisante' }));
    }
  };

  const openForm = (code: string) => {
    setForm({ ...EMPTY_INTEGRATION_FORM, ean: code });
    setFormErrors([]);
    setActivate(isManager);
  };

  const sendToValidation = async () => {
    if (scan.kind !== 'unknown') return;
    try {
      const res = await productIntegrationApi.createRequest({ barcode: scan.barcode, source });
      setNotice({
        tone: 'ok',
        text: res.data?.alreadyPending
          ? 'Une demande est déjà en attente pour ce code-barres.'
          : 'Demande envoyée en attente de validation.',
      });
      setScan({ kind: 'idle' });
      onChanged?.();
    } catch (e: any) {
      setNotice({
        tone: 'err',
        text: e?.response?.data?.message || 'Impossible de créer la demande.',
      });
    }
  };

  /* ── Création de la fiche ── */

  const submitForm = async () => {
    if (!form || saving) return;
    const { payload, errors } = buildProductPayload(form, {
      activate,
      pin: grantedPin ?? undefined,
    });
    if (!payload) { setFormErrors(errors); return; }
    setSaving(true);
    setFormErrors([]);
    try {
      const res = await productIntegrationApi.createProduct(payload);
      const status = res.data?.product?.status;
      setNotice({
        tone: 'ok',
        text: status === 'active'
          ? `Produit « ${form.name} » créé et actif.`
          : `Produit « ${form.name} » créé — en attente de validation.`,
      });
      setForm(null);
      setGrantedPin(null);
      setScan({ kind: 'idle' });
      onChanged?.();
    } catch (e: any) {
      const data = e?.response?.data;
      if (data?.code === 'PRODUCT_BARCODE_ALREADY_EXISTS' || data?.code === 'PRODUCT_SKU_ALREADY_EXISTS') {
        setFormErrors([data.message || 'Doublon détecté : ce produit existe déjà.']);
      } else if (e?.response?.status === 403) {
        setFormErrors(['Autorisation insuffisante']);
      } else {
        setFormErrors([data?.message || 'Création impossible.']);
      }
    } finally {
      setSaving(false);
    }
  };

  /* ── Rendu ── */

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ScanBarcode size={18} className="text-bo-accent" />
        <h3 className="font-semibold text-sm text-bo-text">Scan produit</h3>
        <span className="text-xs text-gray-400 ml-auto">
          douchette ou saisie + Entrée
        </span>
      </div>

      <input
        ref={inputRef}
        type="text"
        className={`${INP} font-mono`}
        placeholder="Scannez ou saisissez un code-barres…"
        value={barcode}
        onChange={(e) => setBarcode(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') doScan(barcode); }}
      />

      {notice && (
        <div
          className={`p-3 rounded-xl text-sm flex items-start gap-2 ${
            notice.tone === 'ok'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {notice.tone === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      {scan.kind === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" /> Recherche de {scan.barcode}…
        </div>
      )}

      {/* ── Produit trouvé : fiche ── */}
      {scan.kind === 'found' && (
        <div className="rounded-xl border border-gray-100 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-bo-text">{scan.product.name}</p>
              <p className="text-xs font-mono text-gray-400">{scan.product.ean}</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-lg font-medium ${(STATUS_LABELS[scan.product.status] ?? STATUS_LABELS.active).cls}`}>
              {(STATUS_LABELS[scan.product.status] ?? STATUS_LABELS.active).label}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg bg-gray-50 p-2.5">
              <p className="text-xs text-gray-400">Prix</p>
              <p className="font-semibold">{formatEuros(scan.product.priceMinorUnits)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-2.5">
              <p className="text-xs text-gray-400">Stock</p>
              <p className="font-semibold">{scan.product.stockQuantity}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-2.5">
              <p className="text-xs text-gray-400">Magasin</p>
              <p className="font-semibold text-xs truncate">{scan.product.storeId}</p>
            </div>
          </div>
          {scan.lastSales.length > 0 && (
            <div className="text-xs text-gray-500">
              <p className="font-medium text-gray-600 mb-1 flex items-center gap-1">
                <ShoppingCart size={12} /> Dernières ventes
              </p>
              {scan.lastSales.map((s: any, i: number) => (
                <p key={i}>
                  {new Date(s.soldAt).toLocaleDateString('fr-FR')} — {s.quantity} × {formatEuros(s.unitPriceMinorUnits)}
                </p>
              ))}
            </div>
          )}
          <button onClick={() => setScan({ kind: 'idle' })} className="text-xs text-gray-400 hover:text-gray-600">
            Fermer
          </button>
        </div>
      )}

      {/* ── Produit inconnu ── */}
      {scan.kind === 'unknown' && !form && (
        <div className="rounded-xl border-2 border-orange-200 bg-orange-50/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-orange-500" />
            <p className="font-semibold text-bo-text">Produit inconnu</p>
          </div>
          <p className="text-sm text-gray-600">
            Code-barres scanné : <span className="font-mono font-semibold">{scan.barcode}</span>
            <br />
            Ce produit n&rsquo;existe pas encore dans la base.
          </p>
          {scan.pendingRequest && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              Une demande d&rsquo;intégration est déjà en attente pour ce code-barres
              (source : {scan.pendingRequest.source}).
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={startCreate}
              className="px-4 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              <PackagePlus size={16} /> Créer une fiche produit
            </button>
            <button
              onClick={sendToValidation}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
            >
              <Send size={16} /> Envoyer en attente de validation
            </button>
            <button
              onClick={() => setScan({ kind: 'idle' })}
              className="px-4 py-2.5 rounded-xl text-sm text-gray-500 hover:bg-gray-100 transition-colors"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ── PIN gate : code admin / employé autorisé ── */}
      {pinGate.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPinGate({ open: false, pin: '', error: '', busy: false })} />
          <div className="relative bg-white rounded-2xl shadow-elevated w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-bo-accent/10 text-bo-accent flex items-center justify-center">
                <Lock size={18} />
              </div>
              <div>
                <h3 className="font-bold text-bo-text">Autorisation requise</h3>
                <p className="text-xs text-gray-500">Code admin ou employé autorisé</p>
              </div>
            </div>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              className={`${INP} text-center text-lg tracking-widest`}
              placeholder="••••"
              value={pinGate.pin}
              onChange={(e) => setPinGate((g) => ({ ...g, pin: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') submitPin(); }}
            />
            {pinGate.error && (
              <p className="text-sm text-red-600 font-medium text-center">{pinGate.error}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setPinGate({ open: false, pin: '', error: '', busy: false })}
                className="flex-1 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={submitPin}
                disabled={pinGate.busy || !pinGate.pin.trim()}
                className="flex-1 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {pinGate.busy && <Loader2 size={14} className="animate-spin" />} Valider
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Formulaire « Nouvelle fiche produit » ── */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setForm(null)} />
          <div className="relative bg-white rounded-2xl shadow-elevated w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-bo-text">Nouvelle fiche produit</h3>
              <button onClick={() => setForm(null)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Code-barres (prérempli)</label>
                <input type="text" className={`${INP} font-mono bg-gray-50`} value={form.ean} readOnly />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Nom du produit *</label>
                <input type="text" className={INP} value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Marque</label>
                  <input type="text" className={INP} value={form.brandName}
                    onChange={(e) => setForm({ ...form, brandName: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Fournisseur</label>
                  <input type="text" className={INP} value={form.supplierName}
                    onChange={(e) => setForm({ ...form, supplierName: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Prix d&rsquo;achat (€)</label>
                  <input type="text" inputMode="decimal" className={INP} placeholder="0,80" value={form.costEuros}
                    onChange={(e) => setForm({ ...form, costEuros: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Prix de vente (€) *</label>
                  <input type="text" inputMode="decimal" className={INP} placeholder="1,50" value={form.priceEuros}
                    onChange={(e) => setForm({ ...form, priceEuros: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">TVA (%)</label>
                  <input type="text" inputMode="decimal" className={INP} value={form.taxRate}
                    onChange={(e) => setForm({ ...form, taxRate: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Unité</label>
                  <select className={INP} value={form.unitType}
                    onChange={(e) => setForm({ ...form, unitType: e.target.value })}>
                    <option value="unit">Unité</option>
                    <option value="kg">Kg (pesée)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Stock initial</label>
                  <input type="text" inputMode="numeric" className={INP} value={form.initialStock}
                    onChange={(e) => setForm({ ...form, initialStock: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">SKU</label>
                  <input type="text" className={INP} value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Image (URL, optionnel)</label>
                <input type="text" className={INP} value={form.imageUrl}
                  onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
              </div>

              <div className="rounded-xl bg-gray-50 p-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={activate}
                    onChange={(e) => setActivate(e.target.checked)}
                  />
                  Activer immédiatement (sinon : <span className="font-medium">À valider</span>)
                </label>
                <p className="text-xs text-gray-400 mt-1">
                  L&rsquo;activation directe est réservée aux profils autorisés — le serveur
                  force « À valider » sinon.
                </p>
              </div>

              {formErrors.length > 0 && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 space-y-1">
                  {formErrors.map((err, i) => <p key={i}>{err}</p>)}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setForm(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-100 transition-colors">
                  Annuler
                </button>
                <button onClick={submitForm} disabled={saving}
                  className="flex-[2] py-2.5 rounded-xl bg-bo-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <PackagePlus size={16} />}
                  Créer la fiche produit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
