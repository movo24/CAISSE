import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, Search, X, Pencil, QrCode, KeyRound,
  CheckCircle2, Loader2, UserCheck, UserX, ShieldCheck,
} from 'lucide-react';
import { employeesApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  maxDiscountPercent: number;
  isActive: boolean;
  qrCode?: string;
  createdAt: string;
}

const ROLE_META: Record<string, { label: string; color: string }> = {
  admin: { label: 'Admin', color: 'bg-indigo-50 text-indigo-600' },
  manager: { label: 'Manager', color: 'bg-amber-50 text-amber-600' },
  cashier: { label: 'Caissier', color: 'bg-emerald-50 text-emerald-600' },
};

const emptyForm = {
  firstName: '', lastName: '', email: '', pin: '', role: 'cashier', maxDiscountPercent: 5,
};

export function EmployeesPage() {
  const currentRole = useAuthStore((s) => s.employee?.role);
  const isAdmin = currentRole === 'admin';
  const canManagePin = currentRole === 'admin' || currentRole === 'manager';

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create/edit modal
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [submitting, setSubmitting] = useState(false);

  // PIN modal
  const [pinTarget, setPinTarget] = useState<Employee | null>(null);
  const [pinValue, setPinValue] = useState('');

  // QR modal
  const [qrTarget, setQrTarget] = useState<Employee | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  const flash = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 2500);
  };

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const res = await employeesApi.list();
      setEmployees(res.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Impossible de charger les employés.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setForm({ ...emptyForm });
    setEditing(null);
    setShowForm(false);
    setError(null);
  };

  const openCreate = () => { resetForm(); setShowForm(true); };

  const openEdit = (e: Employee) => {
    setEditing(e);
    setForm({
      firstName: e.firstName, lastName: e.lastName, email: e.email,
      pin: '', role: e.role, maxDiscountPercent: e.maxDiscountPercent ?? 5,
    });
    setShowForm(true);
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) { setError('Nom et prénom obligatoires'); return; }
    if (!form.email.trim()) { setError("L'email est obligatoire"); return; }
    if (!editing && !/^\d{4,8}$/.test(form.pin)) { setError('PIN : 4 à 8 chiffres'); return; }
    setSubmitting(true);
    setError(null);
    try {
      if (editing) {
        await employeesApi.update(editing.id, {
          firstName: form.firstName, lastName: form.lastName, email: form.email,
          role: form.role, maxDiscountPercent: Number(form.maxDiscountPercent),
        });
        flash('Employé mis à jour');
      } else {
        await employeesApi.create({
          firstName: form.firstName, lastName: form.lastName, email: form.email,
          pin: form.pin, role: form.role, maxDiscountPercent: Number(form.maxDiscountPercent),
        });
        flash('Employé créé');
      }
      resetForm();
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePinSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!pinTarget) return;
    if (!/^\d{4,8}$/.test(pinValue)) { setError('PIN : 4 à 8 chiffres'); return; }
    setSubmitting(true);
    try {
      await employeesApi.changePin(pinTarget.id, pinValue);
      flash(`PIN de ${pinTarget.firstName} mis à jour`);
      setPinTarget(null);
      setPinValue('');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur PIN');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (e: Employee) => {
    try {
      if (e.isActive) await employeesApi.deactivate(e.id);
      else await employeesApi.reactivate(e.id);
      flash(e.isActive ? 'Employé désactivé' : 'Employé réactivé');
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur');
    }
  };

  const openQr = async (e: Employee) => {
    setQrTarget(e);
    setQrDataUrl(null);
    setQrLoading(true);
    try {
      const res = await employeesApi.getQr(e.id);
      setQrDataUrl(res.data?.qrCodeDataUrl ?? null);
    } catch {
      setError('Impossible de générer le QR');
    } finally {
      setQrLoading(false);
    }
  };

  const filtered = employees.filter((e) => {
    const q = search.toLowerCase();
    return (
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
            <Users size={28} className="text-bo-accent" />
            Employés
          </h1>
          <p className="text-sm text-bo-muted mt-1">Gestion des accès, rôles, PIN et badges QR</p>
        </div>
        {isAdmin && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-5 py-2.5 bg-bo-accent text-white rounded-xl font-semibold text-sm hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/20"
          >
            <Plus size={16} />
            Ajouter un employé
          </button>
        )}
      </div>

      {success && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={16} /> {success}
        </div>
      )}
      {error && !showForm && !pinTarget && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="relative mb-6 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-bo-muted" />
        <input
          type="text"
          placeholder="Rechercher un employé..."
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
          <Users size={48} className="mx-auto mb-3 opacity-30" />
          <p className="text-lg font-semibold">Aucun employé</p>
          {isAdmin && <p className="text-sm mt-1">Ajoutez un employé pour commencer</p>}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50/50 text-left">
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider">Employé</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider">Rôle</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider text-right">Remise max</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider">Statut</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const r = ROLE_META[e.role] || { label: e.role, color: 'bg-gray-50 text-gray-600' };
                return (
                  <tr key={e.id} className="border-t border-gray-50 hover:bg-gray-50/40 transition-colors">
                    <td className="py-3 px-5">
                      <p className="font-semibold text-sm text-bo-text">{e.firstName} {e.lastName}</p>
                      <p className="text-xs text-bo-muted">{e.email}</p>
                    </td>
                    <td className="py-3 px-5">
                      <span className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${r.color}`}>{r.label}</span>
                    </td>
                    <td className="py-3 px-5 text-right text-sm">{e.maxDiscountPercent ?? 0}%</td>
                    <td className="py-3 px-5">
                      {e.isActive ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Actif
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-300" /> Inactif
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openQr(e)} title="Badge QR" className="p-2 rounded-lg hover:bg-gray-100 text-bo-muted">
                          <QrCode size={15} />
                        </button>
                        {canManagePin && (
                          <button onClick={() => { setError(null); setPinTarget(e); setPinValue(''); }} title="Changer le PIN" className="p-2 rounded-lg hover:bg-gray-100 text-bo-muted">
                            <KeyRound size={15} />
                          </button>
                        )}
                        {isAdmin && (
                          <>
                            <button onClick={() => openEdit(e)} title="Modifier" className="p-2 rounded-lg hover:bg-gray-100 text-bo-muted">
                              <Pencil size={15} />
                            </button>
                            <button
                              onClick={() => toggleActive(e)}
                              title={e.isActive ? 'Désactiver' : 'Réactiver'}
                              className={`p-2 rounded-lg hover:bg-gray-100 ${e.isActive ? 'text-red-400' : 'text-emerald-500'}`}
                            >
                              {e.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create / Edit modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={resetForm} />
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl">
            <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-bo-text">{editing ? "Modifier l'employé" : 'Nouvel employé'}</h2>
              <button onClick={resetForm} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} className="text-bo-muted" /></button>
            </div>
            <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Prénom <span className="text-red-500">*</span></label>
                  <input type="text" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} autoFocus className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Nom <span className="text-red-500">*</span></label>
                  <input type="text" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-text mb-1">Email <span className="text-red-500">*</span></label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
              </div>
              {!editing && (
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">PIN (4-8 chiffres) <span className="text-red-500">*</span></label>
                  <input type="text" inputMode="numeric" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} maxLength={8} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Rôle</label>
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30">
                    {Object.entries(ROLE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-bo-text mb-1">Remise max (%)</label>
                  <input type="number" min={0} max={100} value={form.maxDiscountPercent} onChange={(e) => setForm({ ...form, maxDiscountPercent: Number(e.target.value) })} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs text-bo-muted bg-gray-50 rounded-xl p-3">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-bo-accent" />
                <span>Les permissions découlent du rôle : admin &gt; manager &gt; caissier. Le PIN se modifie via l'action dédiée.</span>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={resetForm} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-bo-muted hover:bg-gray-50">Annuler</button>
                <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-2">
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  {editing ? 'Mettre à jour' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── PIN modal ── */}
      {pinTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setPinTarget(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-bold text-bo-text flex items-center gap-2"><KeyRound size={16} /> PIN — {pinTarget.firstName} {pinTarget.lastName}</h2>
              <button onClick={() => setPinTarget(null)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} className="text-bo-muted" /></button>
            </div>
            <form onSubmit={handlePinSubmit} className="px-6 py-5 space-y-4">
              <input type="text" inputMode="numeric" value={pinValue} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))} maxLength={8} autoFocus placeholder="Nouveau PIN (4-8 chiffres)" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setPinTarget(null)} className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-bo-muted hover:bg-gray-50">Annuler</button>
                <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-semibold hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-2">
                  {submitting && <Loader2 size={14} className="animate-spin" />} Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── QR modal ── */}
      {qrTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setQrTarget(null)} />
          <div className="relative w-full max-w-xs bg-white rounded-2xl shadow-2xl text-center">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-bold text-bo-text">Badge — {qrTarget.firstName}</h2>
              <button onClick={() => setQrTarget(null)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} className="text-bo-muted" /></button>
            </div>
            <div className="p-6 flex flex-col items-center gap-3">
              {qrLoading ? (
                <Loader2 size={32} className="animate-spin text-bo-accent" />
              ) : qrDataUrl ? (
                <>
                  <img src={qrDataUrl} alt="QR badge" className="w-48 h-48" />
                  <a href={qrDataUrl} download={`badge-${qrTarget.firstName}-${qrTarget.lastName}.png`} className="text-xs font-semibold text-bo-accent hover:underline">Télécharger</a>
                </>
              ) : (
                <p className="text-sm text-bo-muted">QR indisponible</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
