import React, { useState, useEffect, useCallback } from 'react';
import {
  Store, Plus, Search, X, MapPin, Globe, Clock,
  CheckCircle2, Loader2, Building2, Trash2, Archive, RotateCcw,
} from 'lucide-react';
import { storesApi, organizationsApi } from '../services/api';
import { checkLegalIds } from '../utils/legalId';

const STORE_TYPE_OPTIONS = [
  { value: 'permanent', label: 'Magasin permanent' },
  { value: 'kiosk', label: 'Kiosque' },
  { value: 'corner', label: 'Corner' },
  { value: 'popup', label: 'Pop-up store' },
  { value: 'warehouse', label: 'Entrepôt / dépôt' },
  { value: 'office', label: 'Siège / bureau' },
];
const OPERATING_MODE_OPTIONS = [
  { value: 'succursale', label: 'Succursale' },
  { value: 'franchise', label: 'Franchisé' },
  { value: 'affilie', label: 'Affilié' },
  { value: 'licence', label: 'Licence de marque' },
  { value: 'partenaire', label: 'Partenaire' },
  { value: 'autre', label: 'Autre' },
];
const STATUS_OPTIONS = [
  { value: 'projet', label: 'Projet' },
  { value: 'preparation', label: 'En préparation' },
  { value: 'ouvert', label: 'Ouvert' },
  { value: 'ferme_temporaire', label: 'Fermé temporairement' },
  { value: 'ferme_definitif', label: 'Fermé définitivement' },
];
const LEGAL_FORM_OPTIONS = ['SAS', 'SASU', 'SARL', 'EURL', 'SA', 'Micro-entreprise', 'Autre'];
/** Operating modes that require an operating company. */
const MODES_REQUIRING_COMPANY = ['franchise', 'affilie', 'licence', 'partenaire'];

const INP = 'w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30';

function SectionTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2 pt-3 pb-1 border-b border-gray-100">
      <span className="w-5 h-5 rounded-md bg-bo-accent/10 text-bo-accent text-xs font-bold flex items-center justify-center">{n}</span>
      <h3 className="text-sm font-bold text-bo-text">{title}</h3>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-bo-text mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

interface StoreItem {
  id: string;
  name: string;
  storeCode?: string;
  address: string;
  city?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
  currencyCode: string;
  timezone: string;
  organizationId?: string;
  unitId?: string;
  isActive: boolean;
  organization?: { id: string; name: string };
  unit?: { id: string; name: string };
  createdAt: string;
}

const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon→Sun

interface ScheduleDay {
  dayOfWeek: number;
  closed: boolean;
  openTime: string;
  closeTime: string;
}

function ScheduleEditor({ storeId }: { storeId: string }) {
  const [schedule, setSchedule] = useState<ScheduleDay[]>(
    DAY_ORDER.map((d) => ({ dayOfWeek: d, closed: false, openTime: '09:00', closeTime: '20:00' }))
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    storesApi.getSchedule(storeId).then((res) => {
      const data = Array.isArray(res.data) ? res.data : [];
      if (data.length > 0) {
        setSchedule(DAY_ORDER.map((d) => {
          const found = data.find((s: any) => s.dayOfWeek === d);
          return found
            ? { dayOfWeek: d, closed: found.closed, openTime: found.openTime || '09:00', closeTime: found.closeTime || '20:00' }
            : { dayOfWeek: d, closed: false, openTime: '09:00', closeTime: '20:00' };
        }));
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [storeId]);

  const handleSaveSchedule = async () => {
    setSaving(true);
    try {
      await storesApi.updateSchedule(storeId, schedule);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      alert('Erreur sauvegarde horaires');
    } finally {
      setSaving(false);
    }
  };

  const updateDay = (dayOfWeek: number, field: string, value: any) => {
    setSchedule((prev) =>
      prev.map((d) => d.dayOfWeek === dayOfWeek ? { ...d, [field]: value } : d)
    );
  };

  if (loading) return <div className="text-sm text-bo-muted py-2">Chargement horaires...</div>;

  return (
    <div className="border-t border-gray-100 pt-4 mt-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-bo-text flex items-center gap-2">
          <Clock size={16} className="text-bo-accent" />
          Horaires d'ouverture
        </h3>
        <button
          type="button"
          onClick={handleSaveSchedule}
          disabled={saving}
          className="px-3 py-1.5 bg-bo-accent text-white text-xs font-semibold rounded-lg hover:bg-bo-accent/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Sauvegarde...' : saved ? '✓ Sauvegardé' : 'Enregistrer horaires'}
        </button>
      </div>
      <div className="space-y-1.5">
        {schedule.map((day) => (
          <div key={day.dayOfWeek} className={`flex items-center gap-3 py-1.5 px-3 rounded-lg ${day.closed ? 'bg-gray-50' : 'bg-white'}`}>
            <span className="w-24 text-xs font-medium text-bo-text">{DAY_NAMES[day.dayOfWeek]}</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={!day.closed}
                onChange={(e) => updateDay(day.dayOfWeek, 'closed', !e.target.checked)}
                className="rounded border-gray-300 text-bo-accent focus:ring-bo-accent/30"
              />
              <span className="text-xs text-bo-muted">Ouvert</span>
            </label>
            {!day.closed && (
              <>
                <input
                  type="time"
                  value={day.openTime}
                  onChange={(e) => updateDay(day.dayOfWeek, 'openTime', e.target.value)}
                  className="px-2 py-1 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-bo-accent/30"
                />
                <span className="text-xs text-bo-muted">→</span>
                <input
                  type="time"
                  value={day.closeTime}
                  onChange={(e) => updateDay(day.dayOfWeek, 'closeTime', e.target.value)}
                  className="px-2 py-1 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-bo-accent/30"
                />
              </>
            )}
            {day.closed && <span className="text-xs text-red-400 italic">Fermé</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StoresManagementPage() {
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingStore, setEditingStore] = useState<StoreItem | null>(null);
  const EMPTY_FORM = {
    // Commercial identity
    name: '', storeCode: '', storeType: 'permanent', address: '', addressExtra: '',
    city: '', postalCode: '', country: 'France', currencyCode: 'EUR', timezone: 'Europe/Paris',
    phone: '', email: '',
    // Operating mode
    operatingMode: 'succursale', status: 'projet', expectedOpeningDate: '', actualOpeningDate: '',
    // Operating company / legal identity
    operatingCompanyName: '', operatingCompanyTradeName: '', formeJuridique: '',
    siren: '', siret: '', tvaIntracom: '', rcs: '',
    // Operational cash parameters
    isActive: true, allowPos: true, allowStock: true, allowReporting: true, isPilotStore: false,
    managerName: '', managerEmail: '', managerPhone: '',
    // Group / network
    organizationId: '',
  };
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [storesRes, orgsRes] = await Promise.all([
        storesApi.list(),
        organizationsApi.list(),
      ]);
      setStores(storesRes.data || []);
      setOrgs((orgsRes.data || []).map((o: any) => ({ id: o.id, name: o.name })));
    } catch {
      setError('Erreur chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setFormData({ ...EMPTY_FORM });
    setEditingStore(null);
    setShowForm(false);
    setError(null);
  };

  const legal = checkLegalIds(formData.siren, formData.siret);
  const requiresCompany = MODES_REQUIRING_COMPANY.includes(formData.operatingMode);
  const companyMissing = requiresCompany && !formData.operatingCompanyName.trim();
  const dateOrderError =
    formData.expectedOpeningDate && formData.actualOpeningDate && formData.actualOpeningDate < formData.expectedOpeningDate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) { setError('Le nom commercial est obligatoire'); return; }
    if (companyMissing) {
      setError(`Le mode « ${OPERATING_MODE_OPTIONS.find((m) => m.value === formData.operatingMode)?.label} » exige une société exploitante.`);
      return;
    }
    if (legal.sirenError) { setError(legal.sirenError); return; }
    if (legal.siretError) { setError(legal.siretError); return; }
    setSubmitting(true);
    setError(null);

    try {
      // Strip empty strings — only send non-empty optional fields
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(formData)) {
        if (typeof value === 'string' && value.trim() === '') continue;
        payload[key] = value;
      }
      // Name is required — always include even if somehow empty (caught above)
      payload.name = formData.name.trim();
      // Send the auto-filled SIREN (derived from the SIRET when left empty).
      if (legal.siren) payload.siren = legal.siren;

      if (editingStore) {
        await storesApi.update(editingStore.id, payload);
        setSuccess('Magasin mis a jour');
      } else {
        await storesApi.create(payload);
        setSuccess('Magasin cree');
      }
      resetForm();
      loadData();
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      const data = err.response?.data;
      // Show detailed validation errors if available
      if (data?.details && Array.isArray(data.details)) {
        setError(data.details.join(' | '));
      } else if (typeof data?.message === 'string') {
        setError(data.message);
      } else if (Array.isArray(data?.message)) {
        setError(data.message.join(' | '));
      } else {
        setError('Erreur lors de la sauvegarde');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = stores.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.city || '').toLowerCase().includes(search.toLowerCase()),
  );


  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
            <Store size={28} className="text-bo-accent" />
            Magasins
          </h1>
          <p className="text-sm text-bo-muted mt-1">Tous les points de vente du reseau</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-bo-accent text-white rounded-xl font-semibold text-sm hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/20"
        >
          <Plus size={16} />
          Ajouter un magasin
        </button>
      </div>

      {success && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      <div className="relative mb-6 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-bo-muted" />
        <input
          type="text"
          placeholder="Rechercher par nom ou ville..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-bo-accent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-bo-muted">
          <Store size={48} className="mx-auto mb-3 opacity-30" />
          <p className="text-lg font-semibold">Aucun magasin</p>
          <p className="text-sm mt-1">Ajoutez votre premier point de vente</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((store) => (
            <div
              key={store.id}
              className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-lg transition-shadow cursor-pointer group"
              onClick={() => {
                setEditingStore(store);
                const s = store as any;
                setFormData({
                  ...EMPTY_FORM,
                  name: store.name,
                  storeCode: store.storeCode || '',
                  storeType: s.storeType || 'permanent',
                  address: store.address || '',
                  addressExtra: s.addressExtra || '',
                  city: store.city || '',
                  postalCode: store.postalCode || '',
                  country: s.country || 'France',
                  phone: store.phone || '',
                  email: store.email || '',
                  currencyCode: store.currencyCode || 'EUR',
                  timezone: store.timezone || 'Europe/Paris',
                  operatingMode: s.operatingMode || 'succursale',
                  status: s.status || 'ouvert',
                  expectedOpeningDate: (s.expectedOpeningDate || '').slice(0, 10),
                  actualOpeningDate: (s.actualOpeningDate || '').slice(0, 10),
                  operatingCompanyName: s.operatingCompanyName || '',
                  operatingCompanyTradeName: s.operatingCompanyTradeName || '',
                  formeJuridique: s.formeJuridique || '',
                  siren: s.siren || '',
                  siret: s.siret || '',
                  tvaIntracom: s.tvaIntracom || '',
                  rcs: s.rcs || '',
                  isActive: s.isActive !== false,
                  allowPos: s.allowPos !== false,
                  allowStock: s.allowStock !== false,
                  allowReporting: s.allowReporting !== false,
                  isPilotStore: !!s.isPilotStore,
                  managerName: s.managerName || '',
                  managerEmail: s.managerEmail || '',
                  managerPhone: s.managerPhone || '',
                  organizationId: store.organizationId || '',
                });
                setShowForm(true);
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-bold text-bo-text">{store.name}</h3>
                  {store.storeCode && (
                    <span className="inline-block mt-0.5 text-[10px] font-mono font-semibold text-bo-accent bg-indigo-50 px-2 py-0.5 rounded-md">
                      {store.storeCode}
                    </span>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-xs text-bo-muted">
                    {store.organization && (
                      <span className="flex items-center gap-1">
                        <Building2 size={10} /> {store.organization.name}
                      </span>
                    )}
                    {store.unit && (
                      <span className="flex items-center gap-1">
                        / {store.unit.name}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  (store as any).isArchived
                    ? 'bg-amber-100 text-amber-700'
                    : store.isActive
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {(store as any).isArchived ? 'Archivé' : store.isActive ? 'Actif' : 'Inactif'}
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-bo-muted">
                {store.city && (
                  <div className="flex items-center gap-2">
                    <MapPin size={12} /> {store.city}{store.postalCode ? ` ${store.postalCode}` : ''}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Clock size={12} /> {store.timezone}
                </div>
                <div className="flex items-center gap-2">
                  <Globe size={12} /> {store.currencyCode}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={resetForm} />
          <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-8 py-5 border-b border-gray-100 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-bold text-bo-text">
                {editingStore ? 'Modifier le magasin' : 'Nouveau magasin'}
              </h2>
              <button onClick={resetForm} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={18} className="text-bo-muted" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
              {/* ══ SECTION 1 — Identité commerciale du magasin ══ */}
              <SectionTitle n={1} title="Identité commerciale du magasin" />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Nom commercial du magasin" required>
                  <input type="text" value={formData.name} placeholder="The Wesley's Cergy 3 Fontaines"
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })} className={INP} autoFocus />
                </Field>
                <Field label={`Code magasin${!editingStore ? ' (généré, modifiable)' : ''}`}>
                  <input type="text" value={formData.storeCode} placeholder="WES-CERGY-001 (auto si vide)"
                    readOnly={!!editingStore}
                    onChange={(e) => setFormData({ ...formData, storeCode: e.target.value })}
                    className={editingStore ? INP + ' bg-gray-50 font-mono text-bo-muted' : INP + ' font-mono'} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Type de point de vente" required>
                  <select value={formData.storeType} onChange={(e) => setFormData({ ...formData, storeType: e.target.value })} className={INP}>
                    {STORE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Pays" required>
                  <input type="text" value={formData.country} onChange={(e) => setFormData({ ...formData, country: e.target.value })} className={INP} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Adresse du point de vente" required>
                  <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className={INP} />
                </Field>
                <Field label="Complément d'adresse">
                  <input type="text" value={formData.addressExtra} onChange={(e) => setFormData({ ...formData, addressExtra: e.target.value })} className={INP} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Ville" required>
                  <input type="text" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} className={INP} />
                </Field>
                <Field label="Code postal" required>
                  <input type="text" value={formData.postalCode} onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })} className={INP} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Devise" required>
                  <input type="text" value={formData.currencyCode} onChange={(e) => setFormData({ ...formData, currencyCode: e.target.value })} className={INP} />
                </Field>
                <Field label="Fuseau horaire" required>
                  <input type="text" value={formData.timezone} onChange={(e) => setFormData({ ...formData, timezone: e.target.value })} className={INP} />
                </Field>
                <Field label="Groupe / réseau">
                  <select value={formData.organizationId} onChange={(e) => setFormData({ ...formData, organizationId: e.target.value })} className={INP}>
                    <option value="">-- Aucun --</option>
                    {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Téléphone magasin">
                  <input type="text" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className={INP} />
                </Field>
                <Field label="Email magasin">
                  <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className={INP} />
                </Field>
              </div>

              {/* ══ SECTION 2 — Mode d'exploitation ══ */}
              <SectionTitle n={2} title="Mode d'exploitation" />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Mode d'exploitation" required>
                  <select value={formData.operatingMode} onChange={(e) => setFormData({ ...formData, operatingMode: e.target.value })} className={INP}>
                    {OPERATING_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Statut du magasin">
                  <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className={INP}>
                    {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              </div>
              {requiresCompany && (
                <p className="text-xs text-amber-600">Ce mode d'exploitation exige une société exploitante (section 3).</p>
              )}
              {formData.operatingMode === 'succursale' && (
                <p className="text-xs text-bo-muted">Succursale : magasin exploité directement par une société du groupe.</p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Date d'ouverture prévue">
                  <input type="date" value={formData.expectedOpeningDate} onChange={(e) => setFormData({ ...formData, expectedOpeningDate: e.target.value })} className={INP} />
                </Field>
                <Field label="Date d'ouverture réelle">
                  <input type="date" value={formData.actualOpeningDate} onChange={(e) => setFormData({ ...formData, actualOpeningDate: e.target.value })} className={INP} />
                </Field>
              </div>
              {dateOrderError && <p className="text-xs text-red-500">La date réelle ne peut pas précéder la date prévue.</p>}

              {/* ══ SECTION 3 — Société exploitante / identité administrative ══ */}
              <SectionTitle n={3} title="Société exploitante / identité administrative" />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Nom de la société exploitante" required={requiresCompany}>
                  <input type="text" value={formData.operatingCompanyName} placeholder="Rail Food SAS"
                    onChange={(e) => setFormData({ ...formData, operatingCompanyName: e.target.value })}
                    className={companyMissing ? INP + ' border-red-300' : INP} />
                  {companyMissing && <p className="text-xs text-red-500 mt-1">Obligatoire pour ce mode d'exploitation.</p>}
                </Field>
                <Field label="Nom d'enseigne si différent">
                  <input type="text" value={formData.operatingCompanyTradeName} placeholder="The Wesley's"
                    onChange={(e) => setFormData({ ...formData, operatingCompanyTradeName: e.target.value })} className={INP} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Forme juridique">
                  <select value={formData.formeJuridique} onChange={(e) => setFormData({ ...formData, formeJuridique: e.target.value })} className={INP}>
                    <option value="">-- Choisir --</option>
                    {LEGAL_FORM_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </Field>
                <Field label="RCS / Ville d'immatriculation">
                  <input type="text" value={formData.rcs} placeholder="RCS Paris"
                    onChange={(e) => setFormData({ ...formData, rcs: e.target.value })} className={INP} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="SIREN (9 chiffres)">
                  <input type="text" inputMode="numeric" value={formData.siren} placeholder="732829320"
                    onChange={(e) => setFormData({ ...formData, siren: e.target.value })}
                    className={legal.sirenError ? INP + ' border-red-300' : INP} />
                  {legal.sirenError && <p className="text-xs text-red-500 mt-1">{legal.sirenError}</p>}
                </Field>
                <Field label="SIRET (14 chiffres)">
                  <input type="text" inputMode="numeric" value={formData.siret} placeholder="73282932000017"
                    onChange={(e) => setFormData({ ...formData, siret: e.target.value })}
                    className={legal.siretError ? INP + ' border-red-300' : INP} />
                  {legal.siretError && <p className="text-xs text-red-500 mt-1">{legal.siretError}</p>}
                  {!legal.siretError && legal.sirenAutoFilled && (
                    <p className="text-xs text-emerald-600 mt-1">SIREN déduit du SIRET : {legal.siren}</p>
                  )}
                </Field>
              </div>
              <Field label="Numéro TVA intracommunautaire">
                <input type="text" value={formData.tvaIntracom} placeholder="FR + clé + SIREN"
                  onChange={(e) => setFormData({ ...formData, tvaIntracom: e.target.value })} className={INP} />
                {formData.siren && !formData.tvaIntracom.trim() && (formData.country || 'France').toLowerCase() === 'france' && (
                  <p className="text-xs text-amber-600 mt-1">Société française avec SIREN : pensez à renseigner la TVA intracommunautaire.</p>
                )}
              </Field>

              {/* ══ SECTION 4 — Paramètres opérationnels caisse ══ */}
              <SectionTitle n={4} title="Paramètres opérationnels caisse" />
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {([
                  ['isActive', 'Magasin actif'],
                  ['allowPos', 'Autoriser caisse POS'],
                  ['allowStock', 'Autoriser stock'],
                  ['allowReporting', 'Autoriser reporting'],
                  ['isPilotStore', 'Magasin pilote / laboratoire'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-bo-text cursor-pointer py-1">
                    <input type="checkbox" checked={formData[key] as boolean}
                      onChange={(e) => setFormData({ ...formData, [key]: e.target.checked })}
                      className="w-4 h-4 rounded accent-bo-accent" />
                    {label}
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Responsable magasin">
                  <input type="text" value={formData.managerName} onChange={(e) => setFormData({ ...formData, managerName: e.target.value })} className={INP} />
                </Field>
                <Field label="Email responsable">
                  <input type="email" value={formData.managerEmail} onChange={(e) => setFormData({ ...formData, managerEmail: e.target.value })} className={INP} />
                </Field>
                <Field label="Téléphone responsable">
                  <input type="text" value={formData.managerPhone} onChange={(e) => setFormData({ ...formData, managerPhone: e.target.value })} className={INP} />
                </Field>
              </div>

              {/* Résumé avant création */}
              {!editingStore && formData.name.trim() && (
                <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 text-sm text-bo-text">
                  Vous allez créer le magasin <strong>{formData.name.trim()}</strong>
                  {formData.operatingCompanyName.trim() && <> , exploité par <strong>{formData.operatingCompanyName.trim()}</strong></>}
                  {' '}en mode <strong>{OPERATING_MODE_OPTIONS.find((m) => m.value === formData.operatingMode)?.label}</strong>.
                </div>
              )}

              {/* ── Horaires d'ouverture ── */}
              {editingStore && (
                <ScheduleEditor storeId={editingStore.id} />
              )}

              {error && <p className="text-sm text-red-500">{error}</p>}

              {/* ── Actions footer ── */}
              <div className="flex justify-between pt-4 border-t border-gray-100 mt-2">
                {editingStore ? (
                  <div className="flex gap-2">
                    {/* Archive / Reactivate */}
                    {(editingStore as any).isArchived ? (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={async () => {
                          setSubmitting(true);
                          try {
                            await storesApi.reactivate(editingStore.id);
                            setSuccess('Magasin réactivé');
                            resetForm();
                            loadData();
                            setTimeout(() => setSuccess(null), 2000);
                          } catch (err: any) {
                            setError(err.response?.data?.message || 'Erreur réactivation');
                          } finally { setSubmitting(false); }
                        }}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-200 text-sm font-semibold text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        <RotateCcw size={14} /> Réactiver
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={async () => {
                          if (!confirm(`Archiver le magasin "${editingStore.name}" ? Il sera masqué mais ses données conservées.`)) return;
                          setSubmitting(true);
                          try {
                            await storesApi.archive(editingStore.id);
                            setSuccess('Magasin archivé');
                            resetForm();
                            loadData();
                            setTimeout(() => setSuccess(null), 2000);
                          } catch (err: any) {
                            setError(err.response?.data?.message || 'Erreur archivage');
                          } finally { setSubmitting(false); }
                        }}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-200 text-sm font-semibold text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                      >
                        <Archive size={14} /> Archiver
                      </button>
                    )}

                    {/* Hard delete */}
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={async () => {
                        const name = editingStore.name;
                        if (!confirm(`⚠️ SUPPRESSION DÉFINITIVE\n\nCette action va supprimer le magasin "${name}" et TOUTES ses données :\n- Ventes et transactions\n- Employés\n- Produits et stock\n- Inventaires\n\nCette action est IRRÉVERSIBLE.\n\nConfirmer ?`)) return;
                        if (!confirm(`Dernière confirmation : supprimer définitivement "${name}" ?`)) return;
                        setSubmitting(true);
                        try {
                          await storesApi.hardDelete(editingStore.id);
                          setSuccess(`Magasin "${name}" supprimé définitivement`);
                          resetForm();
                          loadData();
                          setTimeout(() => setSuccess(null), 3000);
                        } catch (err: any) {
                          setError(err.response?.data?.message || 'Erreur suppression');
                        } finally { setSubmitting(false); }
                      }}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 size={14} /> Supprimer
                    </button>
                  </div>
                ) : <div />}

                <div className="flex gap-3">
                  <button type="button" onClick={resetForm} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-bo-muted hover:bg-gray-50">Annuler</button>
                  <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-2">
                    {submitting && <Loader2 size={14} className="animate-spin" />}
                    {editingStore ? 'Mettre a jour' : 'Creer'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
