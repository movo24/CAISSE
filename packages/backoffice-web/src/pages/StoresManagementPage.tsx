import React, { useState, useEffect, useCallback } from 'react';
import {
  Store, Plus, Search, X, Pencil, MapPin, Globe, Clock,
  CheckCircle2, Loader2, Building2, Users,
} from 'lucide-react';
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
                <div className={`w-2.5 h-2.5 rounded-full ${store.isActive ? 'bg-emerald-400' : 'bg-gray-300'}`} />
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

              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={resetForm} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-bo-muted hover:bg-gray-50">Annuler</button>
                <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-2">
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  {editingStore ? 'Mettre a jour' : 'Creer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
