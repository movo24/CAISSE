import React, { useState, useEffect, useCallback } from 'react';
import {
  Plug, Plus, Search, X, Pencil, Globe, Wifi, WifiOff,
  CheckCircle2, Loader2, AlertCircle, Clock,
} from 'lucide-react';
import { connectedAppsApi, organizationsApi } from '../services/api';
import { safeErrorMessage } from '../utils/safeErrorMessage';

interface ConnectedApp {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  status: string;
  appUrl?: string;
  apiUrl?: string;
  description?: string;
  lastSyncAt?: string;
  lastError?: string;
  isActive: boolean;
  createdAt: string;
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof Wifi }> = {
  active: { label: 'Connectee', color: 'bg-emerald-50 text-emerald-600', icon: Wifi },
  inactive: { label: 'Inactive', color: 'bg-gray-50 text-gray-500', icon: WifiOff },
  error: { label: 'Erreur', color: 'bg-red-50 text-red-500', icon: AlertCircle },
  syncing: { label: 'Synchro...', color: 'bg-amber-50 text-amber-600', icon: Clock },
};

const typeLabels: Record<string, string> = {
  internal: 'Interne',
  external: 'Externe',
  rented: 'Louee',
};

export function ConnectedAppsPage() {
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingApp, setEditingApp] = useState<ConnectedApp | null>(null);
  const [formData, setFormData] = useState({
    organizationId: '', name: '', type: 'internal', description: '',
    appUrl: '', apiUrl: '', webhookUrl: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadOrgs = useCallback(async () => {
    try {
      const res = await organizationsApi.list();
      const list = (res.data || []).map((o: any) => ({ id: o.id, name: o.name }));
      setOrgs(list);
      if (list.length > 0 && !selectedOrgId) setSelectedOrgId(list[0].id);
    } catch {}
  }, []);

  const loadApps = useCallback(async () => {
    if (!selectedOrgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await connectedAppsApi.list(selectedOrgId);
      setApps(res.data || []);
    } catch {
      setError('Erreur chargement');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);
  useEffect(() => { loadApps(); }, [loadApps]);

  const resetForm = () => {
    setFormData({ organizationId: selectedOrgId, name: '', type: 'internal', description: '', appUrl: '', apiUrl: '', webhookUrl: '' });
    setEditingApp(null);
    setShowForm(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) { setError('Le nom est obligatoire'); return; }
    setSubmitting(true);
    setError(null);

    try {
      const payload = { ...formData, organizationId: selectedOrgId };
      if (editingApp) {
        await connectedAppsApi.update(editingApp.id, payload);
        setSuccess('Application mise a jour');
      } else {
        await connectedAppsApi.create(payload);
        setSuccess('Application ajoutee');
      }
      resetForm();
      loadApps();
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(safeErrorMessage(err, 'Erreur'));
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = apps.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
            <Plug size={28} className="text-bo-accent" />
            Applications connectees
          </h1>
          <p className="text-sm text-bo-muted mt-1">Apps internes et tierces connectees au reseau</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-bo-accent text-white rounded-xl font-semibold text-sm hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/20"
        >
          <Plus size={16} />
          Ajouter une application
        </button>
      </div>

      {success && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      {/* Org selector + search */}
      <div className="flex gap-4 mb-6">
        <select
          value={selectedOrgId}
          onChange={(e) => setSelectedOrgId(e.target.value)}
          className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
        >
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-bo-muted" />
          <input
            type="text"
            placeholder="Rechercher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-bo-accent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-bo-muted">
          <Plug size={48} className="mx-auto mb-3 opacity-30" />
          <p className="text-lg font-semibold">Aucune application</p>
          <p className="text-sm mt-1">Connectez vos outils internes et externes</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((app) => {
            const s = statusConfig[app.status] || statusConfig.inactive;
            const StatusIcon = s.icon;
            return (
              <div
                key={app.id}
                className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => {
                  setEditingApp(app);
                  setFormData({
                    organizationId: app.organizationId,
                    name: app.name,
                    type: app.type,
                    description: app.description || '',
                    appUrl: app.appUrl || '',
                    apiUrl: app.apiUrl || '',
                    webhookUrl: '',
                  });
                  setShowForm(true);
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                      <Plug size={18} className="text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-bo-text text-sm">{app.name}</h3>
                      <span className="text-[11px] text-bo-muted">{typeLabels[app.type] || app.type}</span>
                    </div>
                  </div>
                  <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold ${s.color}`}>
                    <StatusIcon size={12} />
                    {s.label}
                  </span>
                </div>

                {app.description && (
                  <p className="text-xs text-bo-muted mt-2 line-clamp-2">{app.description}</p>
                )}

                {app.appUrl && (
                  <div className="flex items-center gap-1.5 text-xs text-bo-muted mt-3">
                    <Globe size={12} />
                    <span className="truncate">{app.appUrl}</span>
                  </div>
                )}

                {app.lastSyncAt && (
                  <p className="text-[10px] text-bo-muted mt-2">
                    Derniere synchro: {new Date(app.lastSyncAt).toLocaleString('fr-FR')}
                  </p>
                )}
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
                {editingApp ? 'Modifier l\'application' : 'Nouvelle application'}
              </h2>
              <button onClick={resetForm} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={18} className="text-bo-muted" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">Nom <span className="text-red-500">*</span></label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Type</label>
                  <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30">
                    <option value="internal">Interne</option>
                    <option value="external">Externe</option>
                    <option value="rented">Louee (SaaS)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">URL de l'application</label>
                <input type="url" value={formData.appUrl} onChange={(e) => setFormData({ ...formData, appUrl: e.target.value })}
                  placeholder="https://..."
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">URL API</label>
                <input type="url" value={formData.apiUrl} onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
                  placeholder="https://api..."
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">Description</label>
                <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={resetForm} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-bo-muted hover:bg-gray-50">Annuler</button>
                <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-2">
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  {editingApp ? 'Mettre a jour' : 'Ajouter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
