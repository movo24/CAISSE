import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, Plus, Search, X, Pencil, Globe, Mail, Phone,
  MapPin, Hash, CheckCircle2, Loader2, ChevronRight,
} from 'lucide-react';
import { organizationsApi } from '../services/api';

interface Organization {
  id: string;
  name: string;
  legalName?: string;
  siret?: string;
  siren?: string;
  tvaIntracom?: string;
  country: string;
  currencyCode: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  logoUrl?: string;
  isActive: boolean;
  notes?: string;
  units?: any[];
  stores?: any[];
  createdAt: string;
}

export function OrganizationsPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [formData, setFormData] = useState({
    name: '', legalName: '', siret: '', siren: '', tvaIntracom: '',
    country: 'FR', currencyCode: 'EUR', email: '', phone: '',
    address: '', city: '', postalCode: '', notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadOrgs = useCallback(async () => {
    try {
      const res = await organizationsApi.list();
      setOrgs(res.data || []);
    } catch {
      setError('Erreur chargement des organisations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const resetForm = () => {
    setFormData({
      name: '', legalName: '', siret: '', siren: '', tvaIntracom: '',
      country: 'FR', currencyCode: 'EUR', email: '', phone: '',
      address: '', city: '', postalCode: '', notes: '',
    });
    setEditingOrg(null);
    setShowForm(false);
    setError(null);
  };

  const openEdit = (org: Organization) => {
    setEditingOrg(org);
    setFormData({
      name: org.name || '',
      legalName: org.legalName || '',
      siret: org.siret || '',
      siren: org.siren || '',
      tvaIntracom: org.tvaIntracom || '',
      country: org.country || 'FR',
      currencyCode: org.currencyCode || 'EUR',
      email: org.email || '',
      phone: org.phone || '',
      address: org.address || '',
      city: org.city || '',
      postalCode: org.postalCode || '',
      notes: org.notes || '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) { setError('Le nom est obligatoire'); return; }
    setSubmitting(true);
    setError(null);

    try {
      if (editingOrg) {
        await organizationsApi.update(editingOrg.id, formData);
        setSuccess('Organisation mise a jour');
      } else {
        await organizationsApi.create(formData);
        setSuccess('Organisation creee');
      }
      resetForm();
      loadOrgs();
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = orgs.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    (o.legalName || '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
            <Building2 size={28} className="text-bo-accent" />
            Organisations
          </h1>
          <p className="text-sm text-bo-muted mt-1">
            Gerez vos groupes et societes
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-bo-accent text-white rounded-xl font-semibold text-sm hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/20"
        >
          <Plus size={16} />
          Ajouter une organisation
        </button>
      </div>

      {success && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      {/* Search */}
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

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-bo-accent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-bo-muted">
          <Building2 size={48} className="mx-auto mb-3 opacity-30" />
          <p className="text-lg font-semibold">Aucune organisation</p>
          <p className="text-sm mt-1">Creez votre premiere organisation pour commencer</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((org) => (
            <div
              key={org.id}
              className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-lg transition-shadow cursor-pointer group"
              onClick={() => openEdit(org)}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white font-bold text-lg">
                    {org.name[0]?.toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-bo-text">{org.name}</h3>
                    {org.legalName && (
                      <p className="text-xs text-bo-muted">{org.legalName}</p>
                    )}
                  </div>
                </div>
                <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-gray-100">
                  <Pencil size={14} className="text-bo-muted" />
                </button>
              </div>

              <div className="space-y-2 text-xs text-bo-muted">
                {org.siret && (
                  <div className="flex items-center gap-2">
                    <Hash size={12} /> SIRET: {org.siret}
                  </div>
                )}
                {org.city && (
                  <div className="flex items-center gap-2">
                    <MapPin size={12} /> {org.city}{org.country ? `, ${org.country}` : ''}
                  </div>
                )}
                {org.email && (
                  <div className="flex items-center gap-2">
                    <Mail size={12} /> {org.email}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-50">
                <div className="flex items-center gap-1.5 text-xs">
                  <Building2 size={12} className="text-bo-accent" />
                  <span className="font-semibold">{org.units?.length || 0}</span>
                  <span className="text-bo-muted">unites</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <Globe size={12} className="text-emerald-500" />
                  <span className="font-semibold">{org.stores?.length || 0}</span>
                  <span className="text-bo-muted">magasins</span>
                </div>
                <ChevronRight size={14} className="ml-auto text-bo-muted opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={resetForm} />
          <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-8 py-5 border-b border-gray-100 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-bold text-bo-text">
                {editingOrg ? 'Modifier l\'organisation' : 'Nouvelle organisation'}
              </h2>
              <button onClick={resetForm} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={18} className="text-bo-muted" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-8 py-6 space-y-5">
              {/* Nom + Raison sociale */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">
                    Nom <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                    placeholder="Mon Groupe"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Raison sociale</label>
                  <input
                    type="text"
                    value={formData.legalName}
                    onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                    placeholder="SAS Mon Groupe"
                  />
                </div>
              </div>

              {/* SIRET + SIREN + TVA */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">SIRET</label>
                  <input
                    type="text"
                    value={formData.siret}
                    onChange={(e) => setFormData({ ...formData, siret: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">SIREN</label>
                  <input
                    type="text"
                    value={formData.siren}
                    onChange={(e) => setFormData({ ...formData, siren: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">TVA Intracom.</label>
                  <input
                    type="text"
                    value={formData.tvaIntracom}
                    onChange={(e) => setFormData({ ...formData, tvaIntracom: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  />
                </div>
              </div>

              {/* Pays + Devise */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Pays</label>
                  <input
                    type="text"
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Devise</label>
                  <input
                    type="text"
                    value={formData.currencyCode}
                    onChange={(e) => setFormData({ ...formData, currencyCode: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  />
                </div>
              </div>

              {/* Contact */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Telephone</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  />
                </div>
              </div>

              {/* Adresse */}
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">Adresse</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Ville</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Code postal</label>
                  <input
                    type="text"
                    value={formData.postalCode}
                    onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                  />
                </div>
              </div>

              {/* Notes */}
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
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-bo-muted hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  {editingOrg ? 'Mettre a jour' : 'Creer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
