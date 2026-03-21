import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Plus,
  Search,
  X,
  UserCircle,
  Shield,
  ShieldCheck,
  Mail,
  Phone,
  Hash,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  CheckCircle2,
  Clock,
  Ban,
  Loader2,
} from 'lucide-react';
import { employeesApi } from '../services/api';

type Role = 'admin' | 'manager' | 'cashier';
type EmployeeStatus = 'active' | 'inactive' | 'suspended';

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  pin: string;
  role: Role;
  status: EmployeeStatus;
  isActive?: boolean;
  createdAt: string;
  lastLogin: string | null;
}

const roleLabels: Record<Role, { label: string; color: string; icon: typeof Shield }> = {
  admin: { label: 'Administrateur', color: 'bg-red-50 text-red-600 ring-red-200', icon: ShieldCheck },
  manager: { label: 'Manager', color: 'bg-indigo-50 text-bo-accent ring-indigo-200', icon: Shield },
  cashier: { label: 'Caissier', color: 'bg-emerald-50 text-emerald-600 ring-emerald-200', icon: UserCircle },
};

const statusLabels: Record<EmployeeStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  active: { label: 'Actif', color: 'text-emerald-600 bg-emerald-50', icon: CheckCircle2 },
  inactive: { label: 'Inactif', color: 'text-gray-400 bg-gray-100', icon: Clock },
  suspended: { label: 'Suspendu', color: 'text-red-500 bg-red-50', icon: Ban },
};

const avatarColors = [
  'from-indigo-400 to-indigo-600',
  'from-rose-400 to-rose-600',
  'from-emerald-400 to-emerald-600',
  'from-amber-400 to-amber-600',
  'from-cyan-400 to-cyan-600',
  'from-violet-400 to-violet-600',
  'from-pink-400 to-pink-600',
  'from-teal-400 to-teal-600',
];

function avatarGradient(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function mapStatus(emp: any): EmployeeStatus {
  if (emp.status) return emp.status;
  if (emp.isActive === false) return 'inactive';
  return 'active';
}

export function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPin, setShowPin] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    pin: '',
    role: 'cashier' as Role,
  });

  const fetchEmployees = useCallback(async () => {
    try {
      setLoading(true);
      const res = await employeesApi.list();
      const emps: any[] = res.data || [];
      setEmployees(
        emps.map((e: any) => ({
          id: e.id,
          firstName: e.firstName || '',
          lastName: e.lastName || '',
          email: e.email || '',
          phone: e.phone || '',
          pin: e.pin || '',
          role: (e.role || 'cashier') as Role,
          status: mapStatus(e),
          isActive: e.isActive !== false,
          createdAt: e.createdAt ? new Date(e.createdAt).toISOString().split('T')[0] : '',
          lastLogin: e.lastLogin || null,
        })),
      );
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur lors du chargement des employes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const resetForm = () => {
    setForm({ firstName: '', lastName: '', email: '', phone: '', pin: '', role: 'cashier' });
    setEditingId(null);
  };

  const openAdd = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = (emp: Employee) => {
    setForm({
      firstName: emp.firstName,
      lastName: emp.lastName,
      email: emp.email,
      phone: emp.phone,
      pin: emp.pin,
      role: emp.role,
    });
    setEditingId(emp.id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.pin.trim()) return;

    try {
      setSaving(true);
      if (editingId) {
        await employeesApi.update(editingId, form);
      } else {
        await employeesApi.create(form);
      }
      setShowModal(false);
      resetForm();
      await fetchEmployees();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Erreur lors de la sauvegarde';
      alert(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Desactiver cet employe ?')) return;
    try {
      await employeesApi.deactivate(id);
      await fetchEmployees();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Erreur lors de la desactivation');
    }
  };

  const toggleStatus = async (id: string) => {
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    try {
      const newActive = emp.status !== 'active';
      await employeesApi.update(id, { isActive: newActive });
      await fetchEmployees();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Erreur lors du changement de statut');
    }
  };

  const filtered = employees.filter((e) => {
    const matchSearch =
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      e.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = filterRole === 'all' || e.role === filterRole;
    return matchSearch && matchRole;
  });

  const countByRole = (role: Role) => employees.filter((e) => e.role === role).length;
  const activeCount = employees.filter((e) => e.status === 'active').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 size={32} className="animate-spin text-bo-accent" />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchEmployees} className="text-red-600 font-medium hover:underline">
            Reessayer
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-bo-text">Employes</h2>
          <p className="text-gray-400 mt-1 text-sm">
            Gestion de l'equipe ({employees.length} membres)
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-bo-accent text-white px-5 py-2.5 rounded-xl font-medium hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/25"
        >
          <Plus size={16} />
          Ajouter un employe
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total employes', value: String(employees.length), icon: Users, color: 'text-bo-accent bg-indigo-50' },
          { label: 'Actifs', value: String(activeCount), icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Managers', value: String(countByRole('manager')), icon: Shield, color: 'text-amber-600 bg-amber-50' },
          { label: 'Caissiers', value: String(countByRole('cashier')), icon: UserCircle, color: 'text-cyan-600 bg-cyan-50' },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-2xl p-4 shadow-soft border border-gray-100/50 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}>
                <Icon size={18} />
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium">{s.label}</p>
                <p className="text-lg font-bold text-bo-text">{s.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher par nom ou email..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {[
            { id: 'all', label: 'Tous' },
            { id: 'admin', label: 'Admin' },
            { id: 'manager', label: 'Manager' },
            { id: 'cashier', label: 'Caissier' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterRole(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filterRole === f.id
                  ? 'bg-white text-bo-text shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Employee cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((emp) => {
          const role = roleLabels[emp.role];
          const status = statusLabels[emp.status];
          const RoleIcon = role.icon;
          const StatusIcon = status.icon;
          const initials = `${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}`;
          const pinVisible = showPin[emp.id];

          return (
            <div
              key={emp.id}
              className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50 hover:shadow-card transition-shadow group"
            >
              {/* Top row */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${avatarGradient(emp.firstName + emp.lastName)} flex items-center justify-center text-white font-bold text-sm`}>
                    {initials}
                  </div>
                  <div>
                    <h3 className="font-semibold text-bo-text">{emp.firstName} {emp.lastName}</h3>
                    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ${role.color}`}>
                      <RoleIcon size={10} />
                      {role.label}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEdit(emp)}
                    className="p-1.5 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-bo-accent transition-colors"
                    title="Modifier"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(emp.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                    title="Desactiver"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Info */}
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  <Mail size={13} className="text-gray-400 flex-shrink-0" />
                  <span className="truncate">{emp.email || '—'}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-500">
                  <Phone size={13} className="text-gray-400 flex-shrink-0" />
                  <span>{emp.phone || '—'}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-500">
                  <Hash size={13} className="text-gray-400 flex-shrink-0" />
                  <span className="font-mono text-xs">
                    PIN : {pinVisible ? emp.pin : '****'}
                  </span>
                  <button
                    onClick={() => setShowPin((s) => ({ ...s, [emp.id]: !s[emp.id] }))}
                    className="text-gray-300 hover:text-gray-500 transition-colors"
                  >
                    {pinVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
              </div>

              {/* Footer */}
              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                <button
                  onClick={() => toggleStatus(emp.id)}
                  className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${status.color} cursor-pointer hover:opacity-80 transition-opacity`}
                >
                  <StatusIcon size={12} />
                  {status.label}
                </button>
                <span className="text-[11px] text-gray-400">
                  {emp.lastLogin ? `Dernier acces : ${emp.lastLogin}` : 'Jamais connecte'}
                </span>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && !loading && (
          <div className="col-span-full py-12 text-center">
            <Users size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400 text-sm">Aucun employe ne correspond a votre recherche</p>
          </div>
        )}
      </div>

      {/* Modal Add/Edit */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setShowModal(false); resetForm(); }} />
          <div className="relative bg-white rounded-2xl shadow-elevated w-full max-w-lg p-6 animate-slide-up">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-bo-text">
                {editingId ? 'Modifier l\'employe' : 'Nouvel employe'}
              </h3>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Nom / Prenom */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Prenom *</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                    placeholder="Marie"
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Nom *</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                    placeholder="Dupont"
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Email</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                    placeholder="marie@caisse.dev"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
              </div>

              {/* Phone */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Telephone</label>
                <div className="relative">
                  <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="tel"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                    placeholder="06 12 34 56 78"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
              </div>

              {/* PIN + Role */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Code PIN *</label>
                  <div className="relative">
                    <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      maxLength={6}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                      placeholder="1234"
                      value={form.pin}
                      onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Role *</label>
                  <select
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent"
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                  >
                    <option value="cashier">Caissier</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Administrateur</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={!form.firstName.trim() || !form.lastName.trim() || !form.pin.trim() || saving}
                className="px-5 py-2.5 rounded-xl text-sm font-medium bg-bo-accent text-white hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingId ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
