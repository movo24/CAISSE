import React, { useState, useEffect, useCallback } from 'react';
import {
  Store, Plus, Search, X, Pencil, MapPin, Globe, Clock,
  CheckCircle2, Loader2, Building2, Users, Trash2, Archive, RotateCcw,
} from 'lucide-react';
import { validateScheduleDays } from '../utils/schedule-validation';
import { storesApi, organizationsApi, unitsApi } from '../services/api';

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

const HOLIDAY_LABELS: Record<string, string> = {
  jour_de_l_an: "Jour de l'an (1ᵉʳ janvier)",
  lundi_de_paques: 'Lundi de Pâques',
  fete_du_travail: 'Fête du Travail (1ᵉʳ mai)',
  victoire_1945: 'Victoire 1945 (8 mai)',
  ascension: 'Ascension',
  lundi_de_pentecote: 'Lundi de Pentecôte',
  fete_nationale: 'Fête nationale (14 juillet)',
  assomption: 'Assomption (15 août)',
  toussaint: 'Toussaint (1ᵉʳ novembre)',
  armistice_1918: 'Armistice 1918 (11 novembre)',
  noel: 'Noël (25 décembre)',
};

function ScheduleEditor({ storeId }: { storeId: string }) {
  const [schedule, setSchedule] = useState<ScheduleDay[]>(
    DAY_ORDER.map((d) => ({ dayOfWeek: d, closed: false, openTime: '09:00', closeTime: '20:00' }))
  );
  const [holidays, setHolidays] = useState<Array<{ key: string; closed: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // client MIRROR of the server validation (UX only — the server re-validates)
  const errors = validateScheduleDays(schedule);
  const hasErrors = Object.keys(errors).length > 0;

  useEffect(() => {
    Promise.all([storesApi.getSchedule(storeId), storesApi.getHolidayClosures(storeId)])
      .then(([schedRes, holRes]) => {
        // schedule datum shape: { source, days } (legacy arrays tolerated)
        const data = Array.isArray(schedRes.data?.days) ? schedRes.data.days : Array.isArray(schedRes.data) ? schedRes.data : [];
        if (data.length > 0) {
          setSchedule(DAY_ORDER.map((d) => {
            const found = data.find((s: any) => s.dayOfWeek === d);
            return found
              ? { dayOfWeek: d, closed: found.closed, openTime: found.openTime || '09:00', closeTime: found.closeTime || '20:00' }
              : { dayOfWeek: d, closed: false, openTime: '09:00', closeTime: '20:00' };
          }));
        }
        if (Array.isArray(holRes.data)) setHolidays(holRes.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [storeId]);

  const handleSaveSchedule = async () => {
    if (hasErrors) return; // mirror only — the server re-validates anyway
    setSaving(true);
    try {
      await storesApi.updateSchedule(storeId, schedule);
      await storesApi.updateHolidayClosures(storeId, holidays.filter((h) => h.closed).map((h) => h.key));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      alert('Erreur sauvegarde horaires');
    } finally {
      setSaving(false);
    }
  };

  const toggleHoliday = (key: string) =>
    setHolidays((prev) => prev.map((h) => (h.key === key ? { ...h, closed: !h.closed } : h)));

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
          disabled={saving || hasErrors}
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
            {!day.closed && errors[day.dayOfWeek] && (
              <span className="text-xs text-red-500">{errors[day.dayOfWeek]}</span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4">
        <h4 className="text-xs font-bold text-bo-text mb-2">Jours fériés — cocher = magasin fermé</h4>
        <div className="grid grid-cols-2 gap-1.5">
          {holidays.map((h) => (
            <label key={h.key} className="flex items-center gap-1.5 cursor-pointer py-1 px-2 rounded-lg bg-white">
              <input
                type="checkbox"
                checked={h.closed}
                onChange={() => toggleHoliday(h.key)}
                className="rounded border-gray-300 text-bo-accent focus:ring-bo-accent/30"
              />
              <span className="text-xs text-bo-text">{HOLIDAY_LABELS[h.key] ?? h.key}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StoresManagementPage() {
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [units, setUnits] = useState<{ id: string; name: string; organizationId: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingStore, setEditingStore] = useState<StoreItem | null>(null);
  const [formData, setFormData] = useState({
    name: '', storeCode: '', address: '', city: '', postalCode: '',
    phone: '', email: '', currencyCode: 'EUR', timezone: 'Europe/Paris',
    organizationId: '', unitId: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [storesRes, orgsRes, unitsRes] = await Promise.all([
        storesApi.list(),
        organizationsApi.list(),
        unitsApi.list(),
      ]);
      setStores(storesRes.data || []);
      setOrgs((orgsRes.data || []).map((o: any) => ({ id: o.id, name: o.name })));
      setUnits((unitsRes.data || []).map((u: any) => ({ id: u.id, name: u.name, organizationId: u.organizationId })));
    } catch {
      setError('Erreur chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setFormData({
      name: '', storeCode: '', address: '', city: '', postalCode: '',
      phone: '', email: '', currencyCode: 'EUR', timezone: 'Europe/Paris',
      organizationId: '', unitId: '',
    });
    setEditingStore(null);
    setShowForm(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) { setError('Le nom est obligatoire'); return; }
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

  const filteredUnits = formData.organizationId
    ? units.filter((u) => u.organizationId === formData.organizationId)
    : units;

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
                setFormData({
                  name: store.name,
                  storeCode: store.storeCode || '',
                  address: store.address || '',
                  city: store.city || '',
                  postalCode: store.postalCode || '',
                  phone: store.phone || '',
                  email: store.email || '',
                  currencyCode: store.currencyCode || 'EUR',
                  timezone: store.timezone || 'Europe/Paris',
                  organizationId: store.organizationId || '',
                  unitId: store.unitId || '',
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
              {/* Hierarchy */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Organisation</label>
                  <select
                    value={formData.organizationId}
                    onChange={(e) => setFormData({ ...formData, organizationId: e.target.value, unitId: '' })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  >
                    <option value="">-- Aucune --</option>
                    {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Unite</label>
                  <select
                    value={formData.unitId}
                    onChange={(e) => setFormData({ ...formData, unitId: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  >
                    <option value="">-- Aucune --</option>
                    {filteredUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Nom du magasin <span className="text-red-500">*</span></label>
                  <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                    autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">
                    Code magasin
                    {!editingStore && <span className="text-bo-muted font-normal ml-1">(genere automatiquement)</span>}
                  </label>
                  {editingStore ? (
                    <input type="text" value={formData.storeCode}
                      readOnly
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm font-mono text-bo-muted cursor-not-allowed" />
                  ) : (
                    <div className="w-full px-4 py-2.5 rounded-xl border border-dashed border-gray-300 bg-gray-50 text-sm font-mono text-bo-muted">
                      {formData.name.trim()
                        ? `~ ${formData.name.trim().slice(0, 3).toUpperCase()}${formData.city ? '-' + formData.city.trim().slice(0, 5).toUpperCase() : ''}-001`
                        : 'Remplissez le nom pour voir la preview'}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">Adresse</label>
                <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Ville</label>
                  <input type="text" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Code postal</label>
                  <input type="text" value={formData.postalCode} onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Devise</label>
                  <input type="text" value={formData.currencyCode} onChange={(e) => setFormData({ ...formData, currencyCode: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Fuseau horaire</label>
                  <input type="text" value={formData.timezone} onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Email</label>
                  <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Telephone</label>
                  <input type="text" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
                </div>
              </div>

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
