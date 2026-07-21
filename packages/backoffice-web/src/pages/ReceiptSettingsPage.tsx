/**
 * Dashboard → Paramètres → Magasins → Ticket de caisse.
 *
 * Source UNIQUE des informations imprimées sur le ticket The Wesley :
 *  - identité légale du magasin (lecture seule ici — éditée dans la fiche
 *    magasin) avec indicateurs « information à compléter » ;
 *  - réglages du ticket (logo, phrases, QR, recommandations, base URL du
 *    ticket numérique) — persistés via PUT /stores/:id/receipt-settings,
 *    chaque modification étant AUDITÉE côté serveur (ancienne/nouvelle valeur).
 *
 * Aperçu 58/80 mm fidèle au moteur d'impression POS ; le ticket de test est
 * explicitement marqué « TEST — SANS VALEUR FISCALE » et n'utilise que des
 * lignes d'exemple, jamais de vraie vente.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Printer, Save, Store as StoreIcon, Upload, X } from 'lucide-react';
import api, { storesApi } from '../services/api';
import officialLogoUrl from '../assets/wesleys-logo-official.png';

interface ReceiptSettings {
  websiteUrl: string | null;
  receiptLogoUrl: string | null;
  receiptQrEnabled: boolean;
  receiptQrText: string | null;
  footerMessage: string | null;
  receiptFinalMessage: string | null;
  receiptShowRecommendations: boolean;
  receiptRecommendationTarget: string | null;
  receiptRecommendationCategoryId: string | null;
  receiptPublicBaseUrl: string | null;
}

interface StoreIdentity {
  name: string;
  operatingCompanyName: string | null;
  formeJuridique: string | null;
  capitalSocial: string | null;
  address: string | null;
  addressExtra: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  siret: string | null;
  rcs: string | null;
  tvaIntracom: string | null;
  nifCaisse: string | null;
  headerMessage: string | null;
}

interface StoreLite {
  id: string;
  name: string;
  city?: string | null;
}

const QR_TEXT_DEFAULT = 'Scannez pour retrouver votre ticket et découvrir nos nouveautés';
const FINAL_DEFAULT = 'Merci et à bientôt chez The Wesley';

/** Champs d'identité requis sur le ticket — affichés « à compléter » si vides. */
const IDENTITY_CHECKS: Array<{ key: keyof StoreIdentity; label: string }> = [
  { key: 'operatingCompanyName', label: 'Raison sociale exploitante' },
  { key: 'address', label: 'Adresse' },
  { key: 'postalCode', label: 'Code postal' },
  { key: 'city', label: 'Ville' },
  { key: 'siret', label: 'SIRET' },
  { key: 'phone', label: 'Téléphone' },
  { key: 'email', label: 'E-mail' },
  { key: 'tvaIntracom', label: 'TVA intracommunautaire' },
  { key: 'rcs', label: 'RCS' },
];

/** Redimensionne + convertit une image en data-URL PNG (max 480 px de large). */
async function fileToLogoDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Image invalide'));
    i.src = dataUrl;
  });
  const maxW = 480;
  const scale = Math.min(1, maxW / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL('image/png');
  if (out.length > 400_000) {
    throw new Error('Logo trop lourd même après compression (max ~300 Ko). Utilisez une image plus petite.');
  }
  return out;
}

export function ReceiptSettingsPage() {
  const [stores, setStores] = useState<StoreLite[]>([]);
  const [storeId, setStoreId] = useState<string>('');
  const [settings, setSettings] = useState<ReceiptSettings | null>(null);
  const [identity, setIdentity] = useState<StoreIdentity | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [previewWidth, setPreviewWidth] = useState<58 | 80>(80);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // ── Chargement des magasins (admin ; repli « accessible » pour manager) ──
  useEffect(() => {
    storesApi
      .list()
      .then((res) => {
        const list: StoreLite[] = (res.data || []).map((s: any) => ({ id: s.id, name: s.name, city: s.city }));
        setStores(list);
        if (list.length > 0) setStoreId((prev) => prev || list[0].id);
      })
      .catch(() =>
        storesApi
          .accessible()
          .then((res) => {
            const list: StoreLite[] = (res.data || []).map((s: any) => ({ id: s.id, name: s.name, city: s.city }));
            setStores(list);
            if (list.length > 0) setStoreId((prev) => prev || list[0].id);
          })
          .catch(() => setMessage({ ok: false, text: 'Impossible de charger les magasins.' })),
      );
  }, []);

  // ── Chargement des réglages du magasin sélectionné ──
  const load = useCallback((id: string) => {
    if (!id) return;
    setLoading(true);
    setMessage(null);
    storesApi
      .getReceiptSettings(id)
      .then((res) => {
        setSettings(res.data.settings);
        setIdentity(res.data.identity);
      })
      .catch((e) =>
        setMessage({ ok: false, text: e?.response?.data?.message || 'Chargement des réglages impossible.' }),
      )
      .finally(() => setLoading(false));
    api
      .get('/products/categories')
      .then((res) => setCategories(Array.isArray(res.data) ? res.data.filter((c: any) => c?.id && c?.name) : []))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    load(storeId);
  }, [storeId, load]);

  const missing = useMemo(
    () => (identity ? IDENTITY_CHECKS.filter((c) => !(identity[c.key] || '').toString().trim()) : []),
    [identity],
  );

  const set = <K extends keyof ReceiptSettings>(key: K, value: ReceiptSettings[K]) =>
    setSettings((s) => (s ? { ...s, [key]: value } : s));

  const save = async () => {
    if (!settings || !storeId) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await storesApi.updateReceiptSettings(storeId, { ...settings });
      setSettings(res.data.settings);
      setIdentity(res.data.identity);
      setMessage({
        ok: true,
        text: 'Réglages enregistrés (modification auditée : utilisateur, date, ancienne/nouvelle valeur).',
      });
    } catch (e: any) {
      setMessage({ ok: false, text: e?.response?.data?.message || 'Enregistrement impossible.' });
    } finally {
      setSaving(false);
    }
  };

  const onLogoFile = async (file: File | null) => {
    if (!file) return;
    try {
      const dataUrl = await fileToLogoDataUrl(file);
      set('receiptLogoUrl', dataUrl);
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Logo invalide.' });
    }
  };

  /** Applique le logo OFFICIEL The Wesley embarqué dans l'application. */
  const useOfficialLogo = async () => {
    try {
      const blob = await (await fetch(officialLogoUrl)).blob();
      const file = new File([blob], 'wesleys-logo-official.png', { type: blob.type || 'image/png' });
      const dataUrl = await fileToLogoDataUrl(file);
      set('receiptLogoUrl', dataUrl);
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Logo officiel indisponible.' });
    }
  };

  const printTest = () => {
    // Impression du ticket de TEST (aperçu) — explicitement marqué sans valeur
    // fiscale. Fenêtre construite par DOM (importNode), jamais document.write.
    const src = previewRef.current?.firstElementChild;
    if (!src) return;
    const w = window.open('', '_blank', 'width=420,height=700');
    if (!w) return;
    const style = w.document.createElement('style');
    style.textContent = `@page{size:${previewWidth}mm auto;margin:0}body{margin:0;display:flex;justify-content:center;background:#fff}`;
    w.document.head.appendChild(style);
    w.document.body.appendChild(w.document.importNode(src, true));
    w.focus();
    w.print();
  };

  const input =
    'w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Printer size={24} /> Ticket de caisse
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Paramètres → Magasins → Ticket de caisse — chaque magasin a sa propre configuration.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StoreIcon size={16} className="text-gray-400" />
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className={input + ' min-w-[220px] bg-white'}
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.city ? ` — ${s.city}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {message && (
        <div
          className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${
            message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {message.ok ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertTriangle size={16} className="mt-0.5" />}
          <span>{message.text}</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Loader2 size={16} className="animate-spin" /> Chargement…
        </div>
      )}

      {settings && identity && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── Colonne gauche : formulaire ── */}
          <div className="space-y-6">
            {/* Identité (lecture seule + à compléter) */}
            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="font-semibold mb-1">Informations imprimées (fiche magasin)</h2>
              <p className="text-xs text-gray-500 mb-3">
                Source unique : la fiche magasin (Administration → Magasins). Une donnée absente n'est
                <strong> pas imprimée</strong> sur le ticket.
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {IDENTITY_CHECKS.map((c) => {
                  const val = (identity[c.key] || '').toString().trim();
                  return (
                    <div key={c.key} className="flex items-center justify-between gap-2 py-0.5">
                      <span className="text-gray-500">{c.label}</span>
                      {val ? (
                        <span className="font-medium truncate max-w-[160px]" title={val}>
                          {val}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-semibold bg-amber-50 px-2 py-0.5 rounded-full">
                          <AlertTriangle size={11} /> information à compléter
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {missing.length > 0 && (
                <p className="text-xs text-amber-600 mt-3">
                  {missing.length} information(s) à compléter dans la fiche magasin — elles n'apparaîtront sur le
                  ticket qu'une fois renseignées.
                </p>
              )}
            </section>

            {/* Logo */}
            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="font-semibold mb-3">Logo officiel</h2>
              <div className="flex items-center gap-4">
                {settings.receiptLogoUrl ? (
                  <div className="relative">
                    <img
                      src={settings.receiptLogoUrl}
                      alt="Logo"
                      className="h-16 max-w-[160px] object-contain border border-gray-200 rounded-lg bg-white p-1"
                      style={{ filter: 'grayscale(100%) contrast(160%)' }}
                    />
                    <button
                      onClick={() => set('receiptLogoUrl', null)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5"
                      title="Supprimer le logo"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="h-16 w-32 border border-dashed border-gray-300 rounded-lg flex items-center justify-center text-xs text-gray-400">
                    Aucun logo
                  </div>
                )}
                <div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={useOfficialLogo}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-pink-600 text-white text-sm font-medium hover:bg-pink-700"
                    >
                      Utiliser le logo officiel The Wesley
                    </button>
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700"
                    >
                      <Upload size={14} /> Importer un fichier
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5">
                    PNG/JPEG — imprimé en noir et blanc, centré. Le logo officiel The Wesley est fourni avec
                    l'application (jamais un logo redessiné).
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => onLogoFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>
            </section>

            {/* Textes */}
            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
              <h2 className="font-semibold">Textes du ticket</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Site Internet</label>
                <input
                  type="url"
                  placeholder="https://…"
                  value={settings.websiteUrl || ''}
                  onChange={(e) => set('websiteUrl', e.target.value || null)}
                  className={input}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phrase personnalisée de fin</label>
                <input
                  type="text"
                  maxLength={200}
                  placeholder="Ex. Échange possible sous 14 jours avec ticket."
                  value={settings.footerMessage || ''}
                  onChange={(e) => set('footerMessage', e.target.value || null)}
                  className={input}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Formule de fin</label>
                <input
                  type="text"
                  maxLength={160}
                  placeholder={`Ex. ${FINAL_DEFAULT}`}
                  value={settings.receiptFinalMessage || ''}
                  onChange={(e) => set('receiptFinalMessage', e.target.value || null)}
                  className={input}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Base URL publique du ticket numérique
                </label>
                <input
                  type="url"
                  placeholder="https://api.addxintelligence.com"
                  value={settings.receiptPublicBaseUrl || ''}
                  onChange={(e) => set('receiptPublicBaseUrl', e.target.value || null)}
                  className={input}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Le QR imprimé pointe vers <code>{'{base}'}/ticket/{'{jeton}'}</code>. Sans base URL, aucun QR
                  n'est imprimé.
                </p>
              </div>
            </section>

            {/* QR + recommandations */}
            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
              <h2 className="font-semibold">QR code &amp; recommandations</h2>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.receiptQrEnabled}
                  onChange={(e) => set('receiptQrEnabled', e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm">Imprimer le QR code du ticket numérique</span>
              </label>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Texte près du QR code</label>
                <input
                  type="text"
                  maxLength={160}
                  placeholder={QR_TEXT_DEFAULT}
                  value={settings.receiptQrText || ''}
                  onChange={(e) => set('receiptQrText', e.target.value || null)}
                  className={input}
                />
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.receiptShowRecommendations}
                  onChange={(e) => set('receiptShowRecommendations', e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm">Afficher des recommandations sur la page du ticket numérique</span>
              </label>
              {settings.receiptShowRecommendations && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Destination commerciale</label>
                    <select
                      value={settings.receiptRecommendationTarget || 'new'}
                      onChange={(e) => set('receiptRecommendationTarget', e.target.value)}
                      className={input + ' bg-white'}
                    >
                      <option value="home">Accueil</option>
                      <option value="new">Nouveautés</option>
                      <option value="category">Catégorie</option>
                    </select>
                  </div>
                  {settings.receiptRecommendationTarget === 'category' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
                      <select
                        value={settings.receiptRecommendationCategoryId || ''}
                        onChange={(e) => set('receiptRecommendationCategoryId', e.target.value || null)}
                        className={input + ' bg-white'}
                      >
                        <option value="">— Choisir —</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </section>

            <div className="flex gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Enregistrer
              </button>
              <button
                onClick={printTest}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-300 text-sm font-semibold hover:bg-gray-50"
              >
                <Printer size={15} /> Imprimer un ticket de test
              </button>
            </div>
          </div>

          {/* ── Colonne droite : aperçu ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Aperçu réel</h2>
              <div className="flex gap-2">
                {([58, 80] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => setPreviewWidth(w)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                      previewWidth === w
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {w} mm
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-gray-100 rounded-2xl p-6 flex justify-center sticky top-6">
              <div ref={previewRef}>
                <TicketPreview settings={settings} identity={identity} widthMm={previewWidth} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Aperçu HTML fidèle au moteur d'impression POS (mêmes règles : champ vide =
 * non imprimé, logo N&B, ventilation TVA, QR). Lignes d'exemple uniquement,
 * marquées « TEST — SANS VALEUR FISCALE ».
 */
function TicketPreview({
  settings,
  identity,
  widthMm,
}: {
  settings: ReceiptSettings;
  identity: StoreIdentity;
  widthMm: 58 | 80;
}) {
  const mmToPx = 3.78;
  const w = Math.round(widthMm * mmToPx);
  const fs = widthMm === 58 ? 10 : 12;
  const small = widthMm === 58 ? 8 : 9;

  const legalBits = [
    identity.siret ? `SIRET ${identity.siret}` : '',
    identity.rcs ? `RCS ${identity.rcs}` : '',
    identity.tvaIntracom ? `TVA ${identity.tvaIntracom}` : '',
    identity.capitalSocial ? `Capital ${identity.capitalSocial}` : '',
  ].filter(Boolean);
  const cityLine = [identity.postalCode, identity.city].filter(Boolean).join(' ');
  const contact = [identity.phone, settings.websiteUrl || ''].filter(Boolean).join(' - ');

  // Lignes d'EXEMPLE (aperçu marqué TEST) — deux taux de TVA pour la ventilation.
  const sample = [
    { name: 'Exemple article A', qty: 2, pu: 3.5, rate: 5.5 },
    { name: 'Exemple article B', qty: 1, pu: 12.9, rate: 20 },
  ];
  const lines = sample.map((s) => ({ ...s, total: s.qty * s.pu }));
  const total = lines.reduce((acc, l) => acc + l.total, 0);
  const vat = Object.entries(
    lines.reduce<Record<string, { ttc: number; tva: number }>>((acc, l) => {
      const cents = Math.round(l.total * 100);
      const tva = Math.round(cents * (l.rate / (100 + l.rate)));
      const k = String(l.rate);
      acc[k] = { ttc: (acc[k]?.ttc || 0) + cents, tva: (acc[k]?.tva || 0) + tva };
      return acc;
    }, {}),
  )
    .map(([rate, v]) => ({ rate, ht: (v.ttc - v.tva) / 100, tva: v.tva / 100, ttc: v.ttc / 100 }))
    .sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate));

  const dash = <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />;
  const center: React.CSSProperties = { textAlign: 'center' };

  return (
    <div
      style={{
        width: w,
        background: '#fff',
        color: '#000',
        fontFamily: "'Courier New', monospace",
        fontSize: fs,
        padding: '12px 10px',
        boxShadow: '0 2px 10px rgba(0,0,0,.15)',
      }}
    >
      <div style={{ ...center, fontWeight: 700 }}>*** TEST — SANS VALEUR FISCALE ***</div>
      {dash}
      {settings.receiptLogoUrl && (
        <img
          src={settings.receiptLogoUrl}
          alt="logo"
          style={{
            display: 'block',
            margin: '0 auto 6px',
            maxWidth: widthMm === 58 ? 128 : 174,
            maxHeight: 68,
            filter: 'grayscale(100%) contrast(160%)',
          }}
        />
      )}
      <div style={{ ...center, fontWeight: 700, fontSize: fs + 2 }}>{identity.name}</div>
      {identity.operatingCompanyName && identity.operatingCompanyName !== identity.name && (
        <div style={{ ...center, fontSize: small }}>{identity.operatingCompanyName}</div>
      )}
      {identity.address && <div style={{ ...center, fontSize: small }}>{identity.address}</div>}
      {cityLine && <div style={{ ...center, fontSize: small }}>{cityLine}</div>}
      {contact && <div style={{ ...center, fontSize: small }}>{contact}</div>}
      {legalBits.length > 0 && <div style={{ ...center, fontSize: small }}>{legalBits.join(' - ')}</div>}
      {identity.headerMessage && <div style={{ ...center, fontSize: small }}>{identity.headerMessage}</div>}
      {dash}
      <div style={{ fontWeight: 700 }}>Ticket TEST-000000</div>
      <div>Date: {new Date().toLocaleString('fr-FR')}</div>
      <div>Vendeur: Aperçu</div>
      {dash}
      {lines.map((l, i) => (
        <div key={i}>
          <div>{l.name}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>
              {'  '}
              {l.qty} x {l.pu.toFixed(2)}
            </span>
            <span>{l.total.toFixed(2)} EUR</span>
          </div>
        </div>
      ))}
      {dash}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Sous-total</span>
        <span>{total.toFixed(2)} EUR</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: fs + 3 }}>
        <span>TOTAL TTC</span>
        <span>{total.toFixed(2)} EUR</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: small }}>
        <thead>
          <tr>
            {['Taux', 'HT', 'TVA', 'TTC'].map((h, i) => (
              <th
                key={h}
                style={{ textAlign: i === 0 ? 'left' : 'right', borderBottom: '1px solid #000', fontWeight: 700 }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vat.map((v) => (
            <tr key={v.rate}>
              <td>{v.rate}%</td>
              <td style={{ textAlign: 'right' }}>{v.ht.toFixed(2)}</td>
              <td style={{ textAlign: 'right' }}>{v.tva.toFixed(2)}</td>
              <td style={{ textAlign: 'right' }}>{v.ttc.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {dash}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Especes</span>
        <span>{total.toFixed(2)} EUR</span>
      </div>
      {dash}
      {settings.footerMessage && <div style={{ ...center }}>{settings.footerMessage}</div>}
      {settings.receiptQrEnabled && (
        <>
          <div
            style={{
              width: widthMm === 58 ? 84 : 98,
              height: widthMm === 58 ? 84 : 98,
              margin: '8px auto 4px',
              border: '2px solid #000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: small,
              fontWeight: 700,
            }}
          >
            QR
          </div>
          <div style={{ ...center, fontSize: small }}>{settings.receiptQrText || QR_TEXT_DEFAULT}</div>
        </>
      )}
      {settings.receiptFinalMessage && (
        <div style={{ ...center, fontWeight: 700, marginTop: 4 }}>{settings.receiptFinalMessage}</div>
      )}
      {identity.nifCaisse && <div style={{ ...center, fontSize: small, marginTop: 4 }}>NIF: {identity.nifCaisse}</div>}
    </div>
  );
}
