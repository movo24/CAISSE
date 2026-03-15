import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck, Users, ChevronDown, ChevronRight, Check, X,
  Save, RotateCcw, Crown, Briefcase, UserCircle, Lock,
  Percent, Ban, ReceiptText, Package, DoorOpen, Printer,
  Trash2, Edit3,
} from 'lucide-react';
import { employeesApi } from '../services/api';

/* ── Types ── */

type Role = 'admin' | 'manager' | 'cashier';

interface RightDef {
  key: string;
  label: string;
  description: string;
  icon: React.ElementType;
  type: 'boolean' | 'percent';
}

interface RoleRights {
  maxDiscountPercent: number;
  canVoidSale: boolean;
  canRefund: boolean;
  canAccessReports: boolean;
  canManageStock: boolean;
  canDeleteTicket: boolean;
  canApplyManualDiscount: boolean;
  canOpenDrawer: boolean;
  canReprintTicket: boolean;
}

interface EmployeeOverride {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
  hasOverride: boolean;
  rights: RoleRights;
}

/* ── Constants ── */

const RIGHTS_DEFS: RightDef[] = [
  { key: 'canVoidSale', label: 'Annuler une vente', description: 'Annuler / vider le panier en cours', icon: Ban, type: 'boolean' },
  { key: 'canRefund', label: 'Remboursements', description: 'Effectuer un remboursement client', icon: RotateCcw, type: 'boolean' },
  { key: 'canApplyManualDiscount', label: 'Remise manuelle', description: 'Appliquer une remise libre sur un article', icon: Percent, type: 'boolean' },
  { key: 'maxDiscountPercent', label: 'Remise max (%)', description: 'Pourcentage maximum de remise autorise', icon: Percent, type: 'percent' },
  { key: 'canAccessReports', label: 'Acces rapports', description: 'Consulter les rapports de vente', icon: ReceiptText, type: 'boolean' },
  { key: 'canManageStock', label: 'Gestion stock', description: 'Modifier les niveaux de stock', icon: Package, type: 'boolean' },
  { key: 'canDeleteTicket', label: 'Supprimer ticket', description: 'Supprimer un ticket de l\'historique', icon: Trash2, type: 'boolean' },
  { key: 'canOpenDrawer', label: 'Ouvrir tiroir-caisse', description: 'Ouvrir le tiroir sans vente', icon: DoorOpen, type: 'boolean' },
  { key: 'canReprintTicket', label: 'Reimprimer ticket', description: 'Imprimer un duplicata de ticket', icon: Printer, type: 'boolean' },
];

const ROLE_META: Record<Role, { label: string; color: string; icon: React.ElementType }> = {
  admin: { label: 'Admin', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: Crown },
  manager: { label: 'Manager', color: 'text-indigo-600 bg-indigo-50 border-indigo-200', icon: Briefcase },
  cashier: { label: 'Caissier', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: UserCircle },
};

const defaultRoleRights: Record<Role, RoleRights> = {
  admin: {
    maxDiscountPercent: 100,
    canVoidSale: true, canRefund: true, canAccessReports: true,
    canManageStock: true, canDeleteTicket: true, canApplyManualDiscount: true,
    canOpenDrawer: true, canReprintTicket: true,
  },
  manager: {
    maxDiscountPercent: 20,
    canVoidSale: true, canRefund: true, canAccessReports: true,
    canManageStock: true, canDeleteTicket: false, canApplyManualDiscount: true,
    canOpenDrawer: true, canReprintTicket: true,
  },
  cashier: {
    maxDiscountPercent: 5,
    canVoidSale: false, canRefund: false, canAccessReports: false,
    canManageStock: false, canDeleteTicket: false, canApplyManualDiscount: false,
    canOpenDrawer: false, canReprintTicket: true,
  },
};

/* ── Component ── */

export function RightsPage() {
  const [roleRights, setRoleRights] = useState<Record<Role, RoleRights>>(defaultRoleRights);
  const [employees, setEmployees] = useState<EmployeeOverride[]>([]);
  const [expandedRole, setExpandedRole] = useState<Role | null>('cashier');
  const [editingEmployee, setEditingEmployee] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    employeesApi.list().then((res) => {
      const emps: any[] = res.data || [];
      setEmployees(emps.map((e: any) => ({
        id: e.id,
        firstName: e.firstName,
        lastName: e.lastName,
        role: (e.role || 'cashier') as Role,
        hasOverride: false,
        rights: { ...defaultRoleRights[(e.role || 'cashier') as Role] || defaultRoleRights.cashier },
      })));
    }).catch(() => {});
  }, []);

  const overrideCount = useMemo(() => employees.filter((e) => e.hasOverride).length, [employees]);

  const toggleRoleRight = (role: Role, key: string) => {
    setRoleRights((prev) => ({
      ...prev,
      [role]: { ...prev[role], [key]: !(prev[role] as any)[key] },
    }));
    setSaved(false);
  };

  const setRolePercent = (role: Role, key: string, value: number) => {
    setRoleRights((prev) => ({
      ...prev,
      [role]: { ...prev[role], [key]: Math.max(0, Math.min(100, value)) },
    }));
    setSaved(false);
  };

  const toggleEmployeeRight = (empId: string, key: string) => {
    setEmployees((prev) =>
      prev.map((e) =>
        e.id === empId ? { ...e, hasOverride: true, rights: { ...e.rights, [key]: !(e.rights as any)[key] } } : e,
      ),
    );
    setSaved(false);
  };

  const setEmployeePercent = (empId: string, key: string, value: number) => {
    setEmployees((prev) =>
      prev.map((e) =>
        e.id === empId ? { ...e, hasOverride: true, rights: { ...e.rights, [key]: Math.max(0, Math.min(100, value)) } } : e,
      ),
    );
    setSaved(false);
  };

  const resetEmployeeToRole = (empId: string) => {
    setEmployees((prev) =>
      prev.map((e) =>
        e.id === empId ? { ...e, hasOverride: false, rights: { ...roleRights[e.role] } } : e,
      ),
    );
    setSaved(false);
  };

  const handleSave = () => {
    // En production: appel API pour sauvegarder
    console.log('[RIGHTS] Saved role defaults:', roleRights);
    console.log('[RIGHTS] Saved employee overrides:', employees.filter((e) => e.hasOverride));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-bo-accent/10 flex items-center justify-center">
              <ShieldCheck size={22} className="text-bo-accent" />
            </div>
            Droits & Permissions
          </h1>
          <p className="text-sm text-bo-muted mt-1">
            Configurez les droits par role et par employe. Les changements sont appliques au prochain login du caissier.
          </p>
        </div>
        <button
          onClick={handleSave}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            saved
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              : 'bg-bo-accent text-white hover:bg-bo-accent/90 shadow-lg shadow-bo-accent/25'
          }`}
        >
          {saved ? <Check size={16} /> : <Save size={16} />}
          {saved ? 'Enregistre !' : 'Enregistrer'}
        </button>
      </div>

      {/* ═══ SECTION 1 : Droits par role ═══ */}
      <div className="bg-white rounded-2xl border border-bo-border/30 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-bo-border/20 bg-bo-subtle/30">
          <h2 className="text-sm font-bold text-bo-text flex items-center gap-2">
            <Users size={16} className="text-bo-accent" />
            Droits par role (defaut)
          </h2>
          <p className="text-xs text-bo-muted mt-0.5">Ces droits s'appliquent a tous les employes du role sauf override individuel.</p>
        </div>

        <div className="divide-y divide-bo-border/10">
          {(['admin', 'manager', 'cashier'] as Role[]).map((role) => {
            const meta = ROLE_META[role];
            const Icon = meta.icon;
            const isExpanded = expandedRole === role;
            const rr = roleRights[role];

            return (
              <div key={role}>
                {/* Role header */}
                <button
                  className="w-full flex items-center justify-between px-6 py-3.5 hover:bg-bo-subtle/20 transition-colors"
                  onClick={() => setExpandedRole(isExpanded ? null : role)}
                >
                  <div className="flex items-center gap-3">
                    <span className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border ${meta.color}`}>
                      <Icon size={13} />
                      {meta.label}
                    </span>
                    <span className="text-xs text-bo-muted">
                      {RIGHTS_DEFS.filter((d) => d.type === 'boolean' && (rr as any)[d.key]).length}/{RIGHTS_DEFS.filter((d) => d.type === 'boolean').length} droits actifs
                      {' · '}Remise max {rr.maxDiscountPercent}%
                    </span>
                  </div>
                  {isExpanded ? <ChevronDown size={16} className="text-bo-muted" /> : <ChevronRight size={16} className="text-bo-muted" />}
                </button>

                {/* Role rights grid */}
                {isExpanded && (
                  <div className="px-6 pb-4 grid grid-cols-3 gap-2.5">
                    {RIGHTS_DEFS.map((def) => {
                      const DefIcon = def.icon;
                      if (def.type === 'percent') {
                        return (
                          <div key={def.key} className="flex items-center gap-3 p-3 rounded-xl bg-bo-subtle/40 border border-bo-border/20">
                            <DefIcon size={15} className="text-bo-accent shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-bo-text truncate">{def.label}</p>
                              <p className="text-[10px] text-bo-muted">{def.description}</p>
                            </div>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={(rr as any)[def.key]}
                              onChange={(e) => setRolePercent(role, def.key, parseInt(e.target.value) || 0)}
                              className="w-16 text-center text-sm font-bold border border-bo-border/40 rounded-lg px-2 py-1 focus:ring-2 focus:ring-bo-accent/30 focus:border-bo-accent outline-none"
                            />
                          </div>
                        );
                      }
                      const val = (rr as any)[def.key] as boolean;
                      return (
                        <button
                          key={def.key}
                          onClick={() => role !== 'admin' && toggleRoleRight(role, def.key)}
                          disabled={role === 'admin'}
                          className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                            val
                              ? 'bg-emerald-50/60 border-emerald-200/60 hover:border-emerald-300'
                              : 'bg-white border-bo-border/20 hover:border-bo-border/50'
                          } ${role === 'admin' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <DefIcon size={15} className={val ? 'text-emerald-600' : 'text-bo-muted/50'} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-bo-text truncate">{def.label}</p>
                            <p className="text-[10px] text-bo-muted">{def.description}</p>
                          </div>
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                            val ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-400'
                          }`}>
                            {val ? <Check size={11} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ SECTION 2 : Overrides par employe ═══ */}
      <div className="bg-white rounded-2xl border border-bo-border/30 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-bo-border/20 bg-bo-subtle/30 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-bo-text flex items-center gap-2">
              <Edit3 size={16} className="text-bo-accent" />
              Overrides individuels
            </h2>
            <p className="text-xs text-bo-muted mt-0.5">
              {overrideCount} employe{overrideCount > 1 ? 's' : ''} avec des droits personnalises
            </p>
          </div>
        </div>

        <div className="divide-y divide-bo-border/10">
          {employees.map((emp) => {
            const meta = ROLE_META[emp.role];
            const RoleIcon = meta.icon;
            const isEditing = editingEmployee === emp.id;

            return (
              <div key={emp.id}>
                <button
                  className="w-full flex items-center justify-between px-6 py-3 hover:bg-bo-subtle/20 transition-colors"
                  onClick={() => setEditingEmployee(isEditing ? null : emp.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-bo-accent/20 to-indigo-100 flex items-center justify-center">
                      <span className="text-[11px] font-bold text-bo-accent">
                        {emp.firstName[0]}{emp.lastName[0]}
                      </span>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-bo-text">{emp.firstName} {emp.lastName}</p>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${meta.color}`}>
                        <RoleIcon size={9} />
                        {meta.label}
                      </span>
                    </div>
                    {emp.hasOverride && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                        OVERRIDE
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-bo-muted">
                      {emp.hasOverride ? 'Droits personnalises' : 'Droits du role'}
                    </span>
                    {isEditing ? <ChevronDown size={14} className="text-bo-muted" /> : <ChevronRight size={14} className="text-bo-muted" />}
                  </div>
                </button>

                {isEditing && (
                  <div className="px-6 pb-4 space-y-3">
                    {emp.hasOverride && (
                      <button
                        onClick={() => resetEmployeeToRole(emp.id)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-bo-accent hover:underline"
                      >
                        <RotateCcw size={12} />
                        Reinitialiser aux droits du role ({ROLE_META[emp.role].label})
                      </button>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      {RIGHTS_DEFS.map((def) => {
                        const DefIcon = def.icon;
                        const roleDefault = (roleRights[emp.role] as any)[def.key];
                        const empVal = (emp.rights as any)[def.key];
                        const isDifferent = empVal !== roleDefault;

                        if (def.type === 'percent') {
                          return (
                            <div key={def.key} className={`flex items-center gap-3 p-3 rounded-xl border ${isDifferent ? 'bg-amber-50/50 border-amber-200/60' : 'bg-bo-subtle/40 border-bo-border/20'}`}>
                              <DefIcon size={14} className="text-bo-accent shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-bo-text truncate">{def.label}</p>
                                {isDifferent && <p className="text-[9px] text-amber-600">Role: {roleDefault}%</p>}
                              </div>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={empVal}
                                onChange={(e) => setEmployeePercent(emp.id, def.key, parseInt(e.target.value) || 0)}
                                className="w-14 text-center text-sm font-bold border border-bo-border/40 rounded-lg px-1.5 py-1 focus:ring-2 focus:ring-bo-accent/30 outline-none"
                              />
                            </div>
                          );
                        }
                        const val = empVal as boolean;
                        return (
                          <button
                            key={def.key}
                            onClick={() => toggleEmployeeRight(emp.id, def.key)}
                            className={`flex items-center gap-2.5 p-3 rounded-xl border transition-all text-left ${
                              isDifferent
                                ? val
                                  ? 'bg-amber-50/60 border-amber-200/60'
                                  : 'bg-red-50/30 border-red-200/40'
                                : val
                                  ? 'bg-emerald-50/60 border-emerald-200/60'
                                  : 'bg-white border-bo-border/20'
                            }`}
                          >
                            <DefIcon size={14} className={val ? (isDifferent ? 'text-amber-600' : 'text-emerald-600') : 'text-bo-muted/50'} />
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-semibold text-bo-text truncate">{def.label}</p>
                              {isDifferent && (
                                <p className="text-[9px] text-amber-600">
                                  Role: {roleDefault ? 'oui' : 'non'}
                                </p>
                              )}
                            </div>
                            <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                              val ? (isDifferent ? 'bg-amber-500' : 'bg-emerald-500') + ' text-white' : 'bg-gray-200 text-gray-400'
                            }`}>
                              {val ? <Check size={9} strokeWidth={3} /> : <X size={9} strokeWidth={3} />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Info */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-100">
        <Lock size={16} className="text-blue-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-semibold text-blue-800">Application des droits</p>
          <p className="text-[11px] text-blue-600 mt-0.5">
            Les droits sont charges au login du caissier sur le POS et caches localement. En mode offline, les droits caches restent actifs.
            Toute modification sera prise en compte au prochain login de l'employe.
          </p>
        </div>
      </div>
    </div>
  );
}
