import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, Plus, Search, X, Pencil, Store,
  CheckCircle2, Loader2, ChevronRight,
} from 'lucide-react';
import { unitsApi, organizationsApi } from '../services/api';

interface Unit {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  country: string;
  currencyCode: string;
  isActive: boolean;
  notes?: string;
  stores?: any[];
  organization?: { id: string; name: string };
  createdAt: string;
}

const typeLabels: Record<string, { label: string; color: string }> = {
  retail: { label: 'Retail', color: 'bg-emerald-50 text-emerald-600' },
  warehouse: { label: 'Entrepot', color: 'bg-amber-50 text-amber-600' },
  headquarters: { label: 'Siege', color: 'bg-indigo-50 text-indigo-600' },
  franchise: { label: 'Franchise', color: 'bg-violet-50 text-violet-600' },
  popup: { label: 'Pop-up', color: 'bg-pink-50 text-pink-600' },
};

export function UnitsPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [formData, setFormData] = useState({
    organizationId: '', name: '', type: 'retail', country: 'FR',
    currencyCode: 'EUR', notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [unitsRes, orgsRes] = await Promise.all([
        unitsApi.list(),
        organizationsApi.list(),
      ]);
      setUnits(unitsRes.data || []);
      setOrgs((orgsRes.data || []).map((o: any) => ({ id: o.id, name: o.name })));
    } catch {
      setError('Erreur chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setFormData({ organizationId: orgs[0]?.id || '', name: '', type: 'retail', country: 'FR', currencyCode: 'EUR', notes: '' });
    setEditingUnit(null);
    setShowForm(false);
    setError(null);
  };

  const openEdit = (unit: Unit) => {
    setEditingUnit(unit);
    setFormData({
      organizationId: unit.organizationId,
      name: unit.name,
      type: unit.type,
      country: unit.country,
      currencyCode: unit.currencyCode,
      notes: unit.notes || '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) { setError('Le nom est obligatoire'); return; }
    if (!formData.organizationId) { setError('Selectionnez une organisation'); return; }
    setSubmitting(true);
    setError(null);

    try {
      if (editingUnit) {
        await unitsApi.update(editingUnit.id, formData);
        setSuccess('Unite mise a jour');
      } else {
        await unitsApi.create(formData);
        setSuccess('Unite creee');
      }
      resetForm();
      loadData();
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = units.filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
            <Building2 size={28} className="text-bo-accent" />
            Unites
          </h1>
          <p className="text-sm text-bo-muted mt-1">Business units, enseignes, departements</p>
        </div>
        <button
          onClick={() => { resetForm(); setFormData((f) => ({ ...f, organizationId: orgs[0]?.id || '' })); setShowForm(true); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-bo-accent text-white rounded-xl font-semibold text-sm hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/20"
        >
          <Plus size={16} />
          Ajouter une unite
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
          placeholder="Rechercher..."
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
          <Building2 size={48} className="mx-auto mb-3 opacity-30" />
          <p className="text-lg font-semibold">Aucune unite</p>
          <p className="text-sm mt-1">Creez une unite pour organiser vos magasins</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((unit) => {
            const t = typeLabels[unit.type] || { label: unit.type, color: 'bg-gray-50 text-gray-600' };
            return (
              <div
                key={unit.id}
                className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-lg transition-shadow cursor-pointer group"
                onClick={() => openEdit(unit)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-bo-text">{unit.name}</h3>
                    <p className="text-xs text-bo-muted mt-0.5">
                      {unit.organization?.name || 'Org inconnue'}
                    </p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${t.color}`}>
                    {t.label}
                  </span>
                </div>

                <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-50">
                  <div className="flex items-center gap-1.5 text-xs">
                    <Store size={12} className="text-emerald-500" />
                    <span className="font-semibold">{unit.stores?.length || 0}</span>
                    <span className="text-bo-muted">magasins</span>
                  </div>
                  <span className="text-xs text-bo-muted">{unit.country}</span>
                  <ChevronRight size={14} className="ml-auto text-bo-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={resetForm} />
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl">
            <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-bo-text">
                {editingUnit ? 'Modifier l\'unite' : 'Nouvelle unite'}
              </h2>
              <button onClick={resetForm} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={18} className="text-bo-muted" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">Organisation <span className="text-red-500">*</span></label>
                <select
                  value={formData.organizationId}
                  onChange={(e) => setFormData({ ...formData, organizationId: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                >
                  <option value="">-- Selectionnez --</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">Nom <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Type</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  >
                    {Object.entries(typeLabels).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Pays</label>
                  <input
                    type="text"
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Devise</label>
                  <input
                    type="text"
                    value={formData.currencyCode}
                    onChange={(e) => setFormData({ ...formData, currencyCode: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={resetForm} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-bo-muted hover:bg-gray-50">Annuler</button>
                <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-2">
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  {editingUnit ? 'Mettre a jour' : 'Creer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
